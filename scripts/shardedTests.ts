/* Sharded integration-test runner.
 *
 * The HMR battery (73 files, ~350 dev-server boots) runs ~46 minutes
 * under plain `bun test` because every file mutates the SAME `example/`
 * fixtures — two servers watching the same tree would cross-trigger
 * rebuilds, so the suite is forced fully serial. This runner breaks that
 * constraint without changing a single test: it copies the repo into N
 * shard directories (node_modules symlinked, so each copy is ~92MB and
 * takes ~1s), deals the test files across them, and runs N `bun test`
 * processes concurrently. Files are serialized inside each copied fixture
 * tree while the copies run in parallel — the same isolation as the serial
 * run, with the same tests and assertions at roughly N× the throughput.
 *
 * Usage:
 *   bun run scripts/shardedTests.ts [testDir] [--shards N]
 *
 * Defaults: testDir=tests/integration/hmr, shards=2 (each shard peaks at
 * roughly 0.5-1GB plus compiler children; more lanes can starve strict
 * filesystem-watch assertions even when CPU and memory have not exhausted).
 * Larger CI hosts can opt into more lanes with --shards.
 * Exit code is non-zero if any shard fails; all `(fail)` lines and the
 * combined totals are printed at the end.
 */
import { cpus } from 'node:os';
import { existsSync, mkdirSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { Glob } from 'bun';

const REPO_ROOT = resolve(import.meta.dir, '..');
const SHARD_PARENT = resolve(REPO_ROOT, '.test-shards');
const DEFAULT_SHARDS = 2;
const RESERVED_CORES = 2;
const MS_PER_MINUTE = 60_000;
const NOT_FOUND = -1;
const MAX_BROWSER_PROCESS_ATTEMPTS = 3;
const BROWSER_RETRY_DELAY_MS = 500;
// A long compiler/browser lane can occasionally have headless Chromium
// reclaimed by the host. Retry only that explicit infrastructure failure in a
// new Bun process; assertion, build, server, and framework failures stay red.
const CLOSED_BROWSER_RE =
	/target page, context or browser has been closed|browser has been closed|Failed to connect[\s\S]*code:\s*"ENOENT"/iu;

// Measured on the full integration inventory. These are scheduling hints,
// not pass/fail thresholds; unknown files fall back to source size.
const DURATION_HINTS_MS: Record<string, number> = {
	'tests/integration/compile.test.ts': 139_473,
	'tests/integration/hmr/frameworks/svelte-hmr.test.ts': 63_523,
	'tests/integration/hmr/lifecycle/angular-config-providers.test.ts': 35_980,
	'tests/integration/hmr/lifecycle/angular-di-injectables.test.ts': 28_872,
	'tests/integration/hmr/lifecycle/angular-external-resources.test.ts': 40_253,
	'tests/integration/hmr/lifecycle/angular-modern-template.test.ts': 40_122,
	'tests/integration/hmr/lifecycle/angular-multifile.test.ts': 33_556,
	'tests/integration/hmr/lifecycle/angular-tiering.test.ts': 75_134,
	'tests/integration/hmr/lifecycle/angular-vendor-ssr.test.ts': 39_206,
	'tests/integration/hmr/lifecycle/cross-cutting-reliability.test.ts': 139_193,
	'tests/integration/hmr/lifecycle/dev-server-memory-ratchet.test.ts': 134_485,
	'tests/integration/hmr/lifecycle/dev-watch-dirs.test.ts': 24_000,
	'tests/integration/hmr/lifecycle/hmr-at-scale.test.ts': 71_014,
	'tests/integration/hmr/lifecycle/html-deeper-coverage.test.ts': 77_784,
	'tests/integration/hmr/lifecycle/htmx-deeper-coverage.test.ts': 78_932,
	'tests/integration/hmr/lifecycle/sourcemap-stack-traces.test.ts': 25_784,
	'tests/integration/hmr/lifecycle/style-preprocessor-roundtrip.test.ts': 29_598,
	'tests/integration/hmr/lifecycle/svelte-deep-coverage.test.ts': 116_783,
	'tests/integration/hmr/lifecycle/svelte-deeper-coverage.test.ts': 147_404,
	'tests/integration/hmr/lifecycle/tailwind-class-discovery.test.ts': 38_694,
	'tests/integration/hmr/lifecycle/tier-zero-ssr.test.ts': 93_000,
	'tests/integration/hmr/lifecycle/typescript-path-aliases.test.ts': 23_216,
	'tests/integration/hmr/lifecycle/vue-deep-coverage.test.ts': 108_581,
	'tests/integration/hmr/lifecycle/vue-deeper-coverage.test.ts': 106_058,
	'tests/integration/hmr/lifecycle/vue-setup-app-hook.test.ts': 21_776
};

// These browser/compiler probes become nondeterministic when several
// compiler-heavy shards saturate the host. Keep their assertions unchanged
// and run them serially from clean runtime state before the parallel shards.
const EXCLUSIVE_TEST_FILES = new Set([
	'tests/integration/compile.test.ts',
	'tests/integration/pwa/runtimeConformance.test.ts',
	'tests/integration/pwa/updateActivationConformance.test.ts',
	'tests/integration/hmr/multiframework/native-target-conformance.test.ts',
	'tests/integration/hmr/assets/asset-hashing.test.ts',
	// These tests deliberately assert prompt filesystem-watch delivery. Running
	// several framework compilers beside them can starve the host watcher and
	// produce rebuild-error/timeouts even though each strict test passes from a
	// clean runtime. Keep the product timeouts strict and remove cross-shard
	// compiler contention from the measurement.
	'tests/integration/hmr/assets/css-hmr.test.ts',
	'tests/integration/hmr/components/component-hmr.test.ts',
	'tests/integration/hmr/frameworks/html-hmr.test.ts',
	'tests/integration/hmr/frameworks/htmx-hmr.test.ts',
	'tests/integration/hmr/frameworks/react-hmr.test.ts',
	'tests/integration/hmr/lifecycle/angular-external-resources.test.ts',
	'tests/integration/hmr/lifecycle/midrebuild-edit.test.ts',
	'tests/integration/hmr/lifecycle/style-preprocessor-roundtrip.test.ts',
	'tests/integration/hmr/lifecycle/tailwind-class-discovery.test.ts',
	'tests/integration/hmr/lifecycle/typescript-path-aliases.test.ts',
	'tests/integration/hmr/lifecycle/cli-crash-loop-guard.test.ts',
	'tests/integration/hmr/lifecycle/html-deeper-coverage.test.ts',
	'tests/integration/hmr/lifecycle/htmx-deeper-coverage.test.ts',
	'tests/integration/hmr/lifecycle/angular-state-preservation.test.ts',
	'tests/integration/hmr/lifecycle/angular-config-providers.test.ts',
	// This case deliberately expands the watched root at runtime. Under a
	// compiler-saturated parallel shard, Bun --hot can independently re-evaluate
	// the bootstrap while AbsoluteJS is processing that watcher event, racing a
	// second listen against the still-live socket. Keep the product assertion
	// strict and remove only the artificial cross-shard compiler pressure.
	'tests/integration/hmr/lifecycle/dev-watch-dirs.test.ts',
	'tests/integration/hmr/lifecycle/hmr-at-scale.test.ts',
	'tests/integration/hmr/lifecycle/svelte-deep-coverage.test.ts',
	'tests/integration/hmr/lifecycle/svelte-deeper-coverage.test.ts',
	'tests/integration/hmr/lifecycle/ssr-mid-rebuild-race.test.ts',
	'tests/integration/hmr/lifecycle/svelte-state-preservation.test.ts',
	'tests/integration/hmr/lifecycle/vue-deep-coverage.test.ts',
	'tests/integration/hmr/lifecycle/vue-deeper-coverage.test.ts',
	'tests/integration/hmr/lifecycle/vue-state-preservation.test.ts',
	'tests/integration/hmr/lifecycle/spa-child-style.test.ts',
	'tests/integration/hmr/lifecycle/tier-zero-ssr.test.ts',
	'tests/integration/hmr/lifecycle/angular-tiering.test.ts',
	'tests/integration/server/prod-hardening.test.ts',
	'tests/integration/server/prod-startup.test.ts',
	'tests/integration/server/prod-ssr.test.ts',
	'tests/integration/images/optimization.test.ts'
]);

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

const schedulingWeight = (file: string) =>
	DURATION_HINTS_MS[file] ?? statSync(resolve(REPO_ROOT, file)).size;

const lightestShardIndex = (weights: number[]) => {
	let target = 0;
	for (let index = 1; index < weights.length; index += 1) {
		if ((weights[index] ?? 0) >= (weights[target] ?? 0)) continue;
		target = index;
	}

	return target;
};

/* Longest-processing-time-first using measured durations where available and
 * source size as a fallback. Greedily place each file into the lightest shard
 * so one memory/build-heavy tail does not determine the entire gate time. */
const partition = (files: string[], shardCount: number) => {
	const weighted = files
		.map((file) => ({
			file,
			weight: schedulingWeight(file)
		}))
		.sort((left, right) => right.weight - left.weight);
	const shards: string[][] = Array.from({ length: shardCount }, () => []);
	const shardWeights = Array.from({ length: shardCount }, () => 0);
	for (const entry of weighted) {
		const target = lightestShardIndex(shardWeights);
		shards[target]?.push(entry.file);
		shardWeights[target] = (shardWeights[target] ?? 0) + entry.weight;
	}

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
	// Runtime caches contain absolute source paths and test-build locks are
	// process-local. Never copy or retain either across isolated shards.
	rmSync(join(shardDir, '.absolutejs'), { force: true, recursive: true });
	rmSync(join(shardDir, '.test-builds'), { force: true, recursive: true });
	rmSync(join(shardDir, 'example', 'build'), {
		force: true,
		recursive: true
	});
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
			'--exclude',
			'.absolutejs',
			'--exclude',
			'.test-builds',
			'--exclude',
			'example/build',
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
	name: string;
	exitCode: number;
	output: string;
	durationMs: number;
};

type RunTestProcessOptions = {
	beforeBrowserRetry?: () => void;
	retryClosedBrowser?: boolean;
};

const runTestProcess = async (
	name: string,
	testCwd: string,
	files: string[],
	options: RunTestProcessOptions = {}
) => {
	const startedAt = performance.now();
	const testEnv: Record<string, string | undefined> = {
		...process.env,
		// Bun loads the repository's .env for `bun run`, but `bun test` files
		// allocate their own isolated ports. Do not let a developer's local
		// server port become a global fixed port for every shard child.
		// Disable Bun's global transpiler cache too: cached modules can retain
		// checkout-specific absolute paths.
		BUN_RUNTIME_TRANSPILER_CACHE_PATH: '0',
		COMPILE_PORT: '0',
		FORCE_COLOR: '0',
		TELEMETRY_OFF: '1'
	};
	// Every shard owns one copied fixture/build tree. Bun otherwise executes up
	// to 20 tests concurrently, allowing files inside the same shard to mutate
	// that tree at the same time. Serialize within each copy; the shard processes
	// still provide N-way parallelism across genuinely isolated worktrees.
	const runAttempt = async (
		attempt: number
	): Promise<{ exitCode: number; output: string }> => {
		const proc = Bun.spawn(
			['bun', 'test', '--max-concurrency=1', ...files],
			{
				cwd: testCwd,
				env: testEnv,
				stderr: 'pipe',
				stdout: 'pipe'
			}
		);
		const [stdout, stderr, attemptExitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited
		]);
		const output = `${stdout}\n${stderr}`;
		const canRecoverBrowser =
			options.retryClosedBrowser === true &&
			attemptExitCode !== 0 &&
			CLOSED_BROWSER_RE.test(output) &&
			attempt < MAX_BROWSER_PROCESS_ATTEMPTS;
		if (!canRecoverBrowser) {
			return { exitCode: attemptExitCode, output };
		}

		console.log(
			`${name} lost Chromium; retrying in a fresh test process ` +
				`(${attempt + 1}/${MAX_BROWSER_PROCESS_ATTEMPTS})`
		);
		options.beforeBrowserRetry?.();
		await Bun.sleep(BROWSER_RETRY_DELAY_MS * attempt);

		return runAttempt(attempt + 1);
	};
	const { exitCode, output } = await runAttempt(1);
	await Bun.write(join(SHARD_PARENT, `${name}.log`), output);

	const result: ShardResult = {
		durationMs: performance.now() - startedAt,
		exitCode,
		name,
		output
	};

	return result;
};

const runShard = async (index: number, files: string[]) =>
	runTestProcess(`shard-${index}`, await prepareShardDir(index), files);

const cleanExclusiveRuntimeArtifacts = () => {
	rmSync(join(REPO_ROOT, '.absolutejs'), { force: true, recursive: true });
	rmSync(join(REPO_ROOT, '.test-builds'), { force: true, recursive: true });
	rmSync(join(REPO_ROOT, 'example', 'build'), {
		force: true,
		recursive: true
	});
};

const runExclusive = (files: string[]) =>
	files.reduce<Promise<ShardResult[]>>(
		async (pendingResults, file, index) => {
			const results = await pendingResults;
			cleanExclusiveRuntimeArtifacts();

			return [
				...results,
				await runTestProcess(`exclusive-${index}`, REPO_ROOT, [file], {
					beforeBrowserRetry: cleanExclusiveRuntimeArtifacts,
					retryClosedBrowser: true
				}).then(logShardCompletion)
			];
		},
		Promise.resolve([])
	);

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
	console.log(`\n--- ${result.name} failures ---`);
	for (const line of failLines) console.log(line);
};

const logShardCompletion = (result: ShardResult) => {
	const mins = (result.durationMs / MS_PER_MINUTE).toFixed(1);
	console.log(
		`${result.name} finished in ${mins}m (exit ${result.exitCode})`
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

	const exclusiveFiles = [...EXCLUSIVE_TEST_FILES].filter((file) =>
		files.includes(file)
	);
	const parallelFiles = files.filter(
		(file) => !EXCLUSIVE_TEST_FILES.has(file)
	);
	const partitions = partition(parallelFiles, shardCount);
	console.log(
		`Running ${files.length} test files from ${testDir} across ` +
			`${partitions.length} shard(s)…`
	);
	partitions.forEach((shard, shardIndex) => {
		console.log(`  shard-${shardIndex}: ${shard.length} files`);
	});

	const startedAt = performance.now();
	const exclusiveResults = exclusiveFiles.length
		? await runExclusive(exclusiveFiles)
		: [];
	const parallelResults = await Promise.all(
		partitions.map((shard, shardIndex) =>
			runShard(shardIndex, shard).then(logShardCompletion)
		)
	);
	const results = [...parallelResults, ...exclusiveResults];

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
			`(full logs: ${relative(process.cwd(), SHARD_PARENT)}/*.log)`
	);
	process.exit(anyFailed ? 1 : 0);
};

await main();
