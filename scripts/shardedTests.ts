/* Sharded integration-test runner.
 *
 * The HMR battery (73 files, ~350 dev-server boots) runs ~46 minutes
 * under plain `bun test` because every file mutates the SAME `example/`
 * fixtures — two servers watching the same tree would cross-trigger
 * rebuilds, so the suite is forced fully serial. This runner breaks that
 * constraint without changing a single test: it copies the repo into N
 * shard directories (node_modules symlinked, so each copy is ~92MB and
 * takes ~1s), deals the test files across them, and runs N `bun test`
 * processes concurrently. Each file keeps its own dev server and its own
 * fixture tree — exactly as hermetic as the serial run, same tests, same
 * assertions, ~N× the wall-clock speed.
 *
 * Usage:
 *   bun run scripts/shardedTests.ts [testDir] [--shards N]
 *
 * Defaults: testDir=tests/integration/hmr, shards=4 (each shard peaks at
 * roughly 0.5-1GB: a bun test process plus one dev server mid-build).
 * Exit code is non-zero if any shard fails; all `(fail)` lines and the
 * combined totals are printed at the end.
 */
import { cpus } from 'node:os';
import { mkdirSync, existsSync, symlinkSync, statSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { Glob } from 'bun';

const REPO_ROOT = resolve(import.meta.dir, '..');
const SHARD_PARENT = resolve(REPO_ROOT, '.test-shards');
const DEFAULT_SHARDS = 4;
const RESERVED_CORES = 2;
const MS_PER_MINUTE = 60_000;
const NOT_FOUND = -1;

type RunnerArgs = { shards: number; testDir: string };

const parseShardCount = (raw: string | undefined) => {
	const shardCount = Number(raw);
	if (!Number.isInteger(shardCount) || shardCount < 1) {
		console.error('--shards expects a positive integer');
		process.exit(1);
	}

	return shardCount;
};

const parseArgs = (): RunnerArgs => {
	const args = process.argv.slice(2);
	const flagIndex = args.indexOf('--shards');
	const shards =
		flagIndex === NOT_FOUND
			? Math.min(
					DEFAULT_SHARDS,
					Math.max(1, cpus().length - RESERVED_CORES)
				)
			: parseShardCount(args[flagIndex + 1]);
	const positional =
		flagIndex === NOT_FOUND
			? args
			: args.filter(
					(_, index) => index !== flagIndex && index !== flagIndex + 1
				);

	return { shards, testDir: positional[0] ?? 'tests/integration/hmr' };
};

const collectTestFiles = async (testDir: string) => {
	const absoluteDir = resolve(REPO_ROOT, testDir);
	if (!existsSync(absoluteDir)) {
		return [];
	}
	const glob = new Glob('**/*.test.ts');
	const files: string[] = [];
	for await (const file of glob.scan({ cwd: absoluteDir })) {
		files.push(join(testDir, file));
	}

	return files.sort();
};

/* Longest-processing-time-first without historical timings: file size is
 * a rough proxy for test count/duration, and the known-heavy files (the
 * memory ratchet's 110 sequential edits, at-scale sweeps) are also the
 * largest. Deal the sorted list snake-wise so no shard collects all the
 * heavy files. */
const partition = (files: string[], shardCount: number) => {
	const weighted = files
		.map((file) => ({
			file,
			size: statSync(resolve(REPO_ROOT, file)).size
		}))
		.sort((left, right) => right.size - left.size);
	const shards: string[][] = Array.from({ length: shardCount }, () => []);
	weighted.forEach((entry, index) => {
		const round = Math.floor(index / shardCount);
		const position = index % shardCount;
		const target = round % 2 === 0 ? position : shardCount - 1 - position;
		shards[target]?.push(entry.file);
	});

	return shards.filter((shard) => shard.length > 0);
};

/* rsync the working tree (INCLUDING uncommitted changes — a worktree
 * would silently test HEAD instead) into the shard dir, sharing
 * node_modules via symlink. --delete keeps reused shard dirs in sync
 * with the current tree so stale build artifacts from a prior run can't
 * leak into this one (excluded paths are protected from deletion, so the
 * node_modules symlink survives). */
const prepareShardDir = async (index: number) => {
	const shardDir = join(SHARD_PARENT, `shard-${index}`);
	mkdirSync(shardDir, { recursive: true });
	const rsync = Bun.spawn(
		[
			'rsync',
			'-a',
			'--delete',
			'--exclude',
			'node_modules',
			'--exclude',
			'.git',
			'--exclude',
			'.test-shards',
			'--exclude',
			'.absolutejs/eslint-cache',
			`${REPO_ROOT}/`,
			`${shardDir}/`
		],
		{ stderr: 'pipe', stdout: 'ignore' }
	);
	const rsyncExit = await rsync.exited;
	if (rsyncExit !== 0) {
		const err = await new Response(rsync.stderr).text();
		throw new Error(`rsync into ${shardDir} failed: ${err}`);
	}
	const nodeModulesLink = join(shardDir, 'node_modules');
	if (!existsSync(nodeModulesLink)) {
		symlinkSync(join(REPO_ROOT, 'node_modules'), nodeModulesLink);
	}

	return shardDir;
};

type ShardResult = {
	index: number;
	exitCode: number;
	output: string;
	durationMs: number;
};

const runShard = async (index: number, files: string[]) => {
	const shardDir = await prepareShardDir(index);
	const startedAt = performance.now();
	const proc = Bun.spawn(['bun', 'test', ...files], {
		cwd: shardDir,
		env: { ...process.env, FORCE_COLOR: '0' },
		stderr: 'pipe',
		stdout: 'pipe'
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited
	]);
	const output = `${stdout}\n${stderr}`;
	await Bun.write(join(SHARD_PARENT, `shard-${index}.log`), output);

	const result: ShardResult = {
		durationMs: performance.now() - startedAt,
		exitCode,
		index,
		output
	};

	return result;
};

const SUMMARY_RE = /^\s*(\d+)\s+(pass|fail|skip)$/gm;

type Totals = { fail: number; pass: number; skip: number };

const accumulateTotals = (totals: Totals, output: string) => {
	for (const match of output.matchAll(SUMMARY_RE)) {
		const [, count, kind] = match;
		if (kind === 'pass') totals.pass += Number(count);
		if (kind === 'fail') totals.fail += Number(count);
		if (kind === 'skip') totals.skip += Number(count);
	}
};

const printShardFailures = (result: ShardResult) => {
	const failLines = result.output
		.split('\n')
		.filter((line) => line.includes('(fail)'));
	if (failLines.length === 0) {
		return;
	}
	console.log(`\n--- shard-${result.index} failures ---`);
	for (const line of failLines) console.log(line);
};

const logShardCompletion = (result: ShardResult) => {
	const mins = (result.durationMs / MS_PER_MINUTE).toFixed(1);
	console.log(
		`shard-${result.index} finished in ${mins}m (exit ${result.exitCode})`
	);

	return result;
};

const main = async () => {
	const { shards: shardCount, testDir } = parseArgs();
	const files = await collectTestFiles(testDir);
	if (files.length === 0) {
		console.error(`No test files found under ${testDir}`);
		process.exit(1);
	}

	const partitions = partition(files, shardCount);
	console.log(
		`Running ${files.length} test files from ${testDir} across ` +
			`${partitions.length} shard(s)…`
	);
	partitions.forEach((shard, shardIndex) => {
		console.log(`  shard-${shardIndex}: ${shard.length} files`);
	});

	const startedAt = performance.now();
	const results = await Promise.all(
		partitions.map((shard, shardIndex) =>
			runShard(shardIndex, shard).then(logShardCompletion)
		)
	);

	const totals: Totals = { fail: 0, pass: 0, skip: 0 };
	let anyFailed = false;
	for (const result of results) {
		if (result.exitCode !== 0) anyFailed = true;
		accumulateTotals(totals, result.output);
		printShardFailures(result);
	}

	const totalMins = ((performance.now() - startedAt) / MS_PER_MINUTE).toFixed(
		1
	);
	console.log(
		`\nTotal: ${totals.pass} pass, ${totals.fail} fail ` +
			`across ${files.length} files in ${totalMins}m ` +
			`(full logs: ${relative(process.cwd(), SHARD_PARENT)}/shard-*.log)`
	);
	process.exit(anyFailed ? 1 : 0);
};

await main();
