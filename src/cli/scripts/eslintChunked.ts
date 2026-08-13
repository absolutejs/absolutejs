import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import {
	createEslintCacheFingerprint,
	getCacheLocation,
	prepareEslintCache
} from './eslint';

/**
 * Chunked, sharded, cache-fingerprinted ESLint orchestration for projects
 * whose type-aware lint program cannot fit in one process.
 *
 * Why this exists: with heavy typed surfaces (e.g. Drizzle row types flowing
 * through a full Eden `Server`), a single whole-repo ESLint pass exceeds the
 * V8 heap and thrashes. Sub-app style imports mean a small batch of files
 * only pulls a bounded slice of the type graph — so files run in fresh
 * per-chunk processes instead of one giant pass.
 *
 * Layers:
 *  - ESLint `--cache --cache-strategy content` so mtime churn (checkouts,
 *    installs) never invalidates a clean verdict.
 *  - Files map to a fixed number of SHARDS by a stable path hash; each shard
 *    owns its own cache file. Chunks within a shard run sequentially, shards
 *    run in parallel — two processes never write one cache file.
 *  - Every shard cache is guarded by the toolchain fingerprint
 *    (`prepareEslintCache`): the INSTALLED manifests of every lint-related
 *    dependency. Plugin upgrades — or node_modules drifting from the lockfile
 *    — drop the caches instead of silently reusing stale verdicts. Config
 *    edits do not: ESLint's own cache hashes each file's calculated config, so
 *    it re-lints exactly the files that override touched.
 *  - `--changed` lints only files that differ from the branch's upstream (or
 *    `--changed-base <ref>`) plus anything staged/unstaged/untracked.
 *    Porcelain status lines are parsed per line WITHOUT trimming their
 *    significant leading whitespace — a whole-output trim once made the
 *    first-sorted dirty file silently vanish from the changed set.
 *  - The aggregated report (all chunks) lands in one file plus a by-rule
 *    summary, because per-chunk output alone is unreviewable.
 *
 * Flags (in addition to pass-through ESLint args):
 *   --chunked            selects this runner (stripped before ESLint runs)
 *   --changed[=<ref>]    changed-only mode; bare form resolves the upstream
 *   --changed-base <ref> explicit diff base for --changed
 *   --out <path>         report location (default .absolutejs/lint-report.txt)
 *   --chunk-size <n>     files per ESLint process (default 20)
 *   --shards <n>         cache shard count (default 4) — changing it
 *                        reshuffles which cache file owns which path
 *   positionals          glob patterns for the lint set; without any, every
 *                        git-visible file with a lintable extension is used
 *
 * Environment: LINT_CONCURRENCY caps parallel chunk processes (default 2).
 */

const DEFAULT_CHUNK_SIZE = 20;
const DEFAULT_SHARDS = 4;
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_REPORT = '.absolutejs/lint-report.txt';
const CHILD_HEAP_MB = 4096;
const DJB2_SEED = 5381;
const DJB2_MULTIPLIER = 33;
const MS_PER_SECOND = 1000;
const SUMMARY_RULE_WIDTH = 60;
const SUMMARY_COUNT_PAD = 5;
/** `git status --porcelain` lines are `XY path`: 2 status chars + a space. */
const PORCELAIN_STATUS_WIDTH = 3;
const RENAME_ARROW = ' -> ';
const ASCII_ESC = 27;
const LINTABLE_EXTENSIONS = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|vue|svelte)$/;

const ANSI_COLOR = new RegExp(
	`${String.fromCharCode(ASCII_ESC)}\\[[0-9;]*m`,
	'g'
);
const stripAnsi = (text: string) => text.replace(ANSI_COLOR, '');

/** Stable djb2-xor hash of the repo-relative path → shard index. */
const shardOf = (path: string, shards: number) =>
	[...path].reduce(
		(accumulator, character) =>
			(Math.imul(accumulator, DJB2_MULTIPLIER) ^
				character.charCodeAt(0)) >>>
			0,
		DJB2_SEED
	) % shards;

const gitLines = (cmd: string[], cwd: string) =>
	Bun.spawnSync(cmd, { cwd })
		.stdout.toString()
		.split('\n')
		.map((line) => line.trimEnd())
		.filter(Boolean);

type EslintRunResult = { combined: string; exitCode: number };

type ChunkedArgs = {
	changedBase: string | null;
	changedOnly: boolean;
	chunkSize: number;
	globs: string[];
	outFile: string;
	passthrough: string[];
	shards: number;
};

const applyChangedBase = (parsed: ChunkedArgs, base: string | null) => {
	parsed.changedOnly = true;
	parsed.changedBase = base;
};

const porcelainPath = (line: string) => {
	const path = line.slice(PORCELAIN_STATUS_WIDTH);
	const [, renameTarget] = path.split(RENAME_ARROW);

	return renameTarget ?? path;
};

const matchesAnyGlob = (file: string, globs: string[]) =>
	globs.some((pattern) => new Bun.Glob(pattern).match(file));

const resolveLintSet = (parsed: ChunkedArgs, cwd: string) => {
	const visible = gitVisibleFiles(cwd);
	const matched =
		parsed.globs.length === 0
			? visible.filter((file) => LINTABLE_EXTENSIONS.test(file))
			: visible.filter((file) => matchesAnyGlob(file, parsed.globs));

	// `ls-files --cached` (and porcelain ` D` lines) still list files deleted
	// from the worktree — passing those to ESLint is a hard error.
	return matched.filter((file) => existsSync(resolve(cwd, file))).sort();
};

/**
 * The exact set of files an `absolute eslint --chunked` invocation lints,
 * resolved through the same glob semantics the run itself uses. `--changed` is
 * deliberately ignored: callers that attest to a run (the lint proof) must
 * cover the whole lint set, not one diff's slice of it.
 */
export const resolveLintTargets = (args: string[], cwd = process.cwd()) =>
	resolveLintSet(parseChunkedArgs(args), cwd);

const buildShardChunks = (
	files: string[],
	shards: number,
	chunkSize: number
) => {
	const shardFiles: string[][] = Array.from({ length: shards }, () => []);
	for (const file of files) shardFiles[shardOf(file, shards)]?.push(file);
	const shardChunks: string[][][] = Array.from({ length: shards }, () => []);
	for (let shard = 0; shard < shards; shard++) {
		const owned = shardFiles[shard] ?? [];
		for (let index = 0; index < owned.length; index += chunkSize)
			shardChunks[shard]?.push(owned.slice(index, index + chunkSize));
	}

	return shardChunks;
};

const runEslintProcess = async (
	chunk: string[],
	cacheLocation: string | null,
	passthrough: string[],
	cwd: string
) => {
	const hasMaxWarnings = passthrough.some((arg) =>
		arg.startsWith('--max-warnings')
	);
	const cacheArgs =
		cacheLocation === null
			? []
			: [
					'--cache',
					'--cache-location',
					cacheLocation,
					'--cache-strategy',
					'content'
				];
	const proc = Bun.spawn(
		[
			resolve(cwd, 'node_modules/.bin/eslint'),
			'--color',
			// Warnings block: any warning fails the chunk, which fails the
			// run, which holds the deploy gate. Callers opt out by passing
			// their own --max-warnings.
			...(hasMaxWarnings ? [] : ['--max-warnings', '0']),
			...cacheArgs,
			...passthrough,
			...chunk
		],
		{
			cwd,
			env: {
				...process.env,
				NODE_OPTIONS: `--max-old-space-size=${CHILD_HEAP_MB}`
			},
			stderr: 'pipe',
			stdout: 'pipe'
		}
	);
	const [out, err, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited
	]);

	return { combined: out + err, exitCode };
};

const retryEachFile = async (
	chunk: string[],
	passthrough: string[],
	cwd: string
) => {
	console.warn(
		`ESLint could not process ${chunk.length} files together; retrying each file`
	);
	const results = [];
	for (const file of chunk) {
		// eslint-disable-next-line no-await-in-loop -- fresh processes stay sequential to bound memory
		results.push(await runEslintProcess([file], null, passthrough, cwd));
	}

	return results;
};

const wasSilentCrash = (results: EslintRunResult[], chunk: string[]) => {
	const [first] = results;

	return (
		first !== undefined &&
		first.exitCode !== 0 &&
		first.combined.trim().length === 0 &&
		chunk.length > 1
	);
};

export const eslintChunked = async (args: string[], cwd = process.cwd()) => {
	const parsed = parseChunkedArgs(args);
	let files = resolveLintSet(parsed, cwd);

	if (parsed.changedOnly) {
		const base = parsed.changedBase ?? upstreamRef(cwd);
		const changed = gitChangedFiles(cwd, base);
		files = files.filter((file) => changed.has(file));
	}
	if (parsed.changedOnly && files.length === 0) {
		console.log(
			'✓ Lint (--changed): no lintable files differ — nothing to do'
		);

		return;
	}

	// One fingerprint guards every shard cache: a changed lint toolchain
	// (config edit, plugin upgrade, drifted node_modules) drops them all.
	const cachePrefix = `${getCacheLocation(args)}-shard-`;
	const fingerprint = createEslintCacheFingerprint(cwd);
	for (let shard = 0; shard < parsed.shards; shard++)
		prepareEslintCache({
			cacheLocation: relative(
				cwd,
				resolve(cwd, `${cachePrefix}${shard}`)
			),
			cwd,
			fingerprint
		});

	const shardChunks = buildShardChunks(
		files,
		parsed.shards,
		parsed.chunkSize
	);
	const totalChunks = shardChunks.reduce((sum, list) => sum + list.length, 0);
	const concurrency = Math.max(
		1,
		Number(process.env.LINT_CONCURRENCY) || DEFAULT_CONCURRENCY
	);
	console.log(
		`Linting ${files.length} files in ${totalChunks} chunks of ${parsed.chunkSize} ` +
			`(${parsed.shards} cache shards, concurrency ${concurrency}${parsed.changedOnly ? ', --changed' : ''})`
	);

	const startedAt = Date.now();
	let failedChunks = 0;
	let completedChunks = 0;
	let report = '';

	const runChunk = async (shard: number, chunk: string[]) => {
		let results = [
			await runEslintProcess(
				chunk,
				`${cachePrefix}${shard}`,
				parsed.passthrough,
				cwd
			)
		];
		if (wasSilentCrash(results, chunk))
			results = await retryEachFile(chunk, parsed.passthrough, cwd);
		const combined = results.map((result) => result.combined).join('');
		const exitCode = results.some((result) => result.exitCode !== 0)
			? 1
			: 0;
		const silentFailure =
			exitCode !== 0 && combined.trim().length === 0
				? `ESLint chunk exited ${exitCode} without diagnostics (${chunk[0]} … ${chunk[chunk.length - 1]})\n`
				: '';
		if (combined.trim()) process.stdout.write(combined);
		if (silentFailure) process.stderr.write(silentFailure);
		report += stripAnsi(combined + silentFailure);
		completedChunks++;
		process.stdout.write(`  · chunk ${completedChunks}/${totalChunks}\n`);
		if (exitCode !== 0) failedChunks++;
	};

	// Deal shard queues across lanes; a lane drains in order so one shard's
	// cache file is never written by two processes at once.
	type LaneChunk = { chunk: string[]; shard: number };
	const lanes: LaneChunk[][] = Array.from({ length: concurrency }, () => []);
	shardChunks.forEach((chunkList, shard) =>
		lanes[shard % concurrency]?.push(
			...chunkList.map((chunk) => ({ chunk, shard }))
		)
	);
	await Promise.all(
		lanes.map((laneChunks) =>
			laneChunks.reduce(
				(previous, item) =>
					previous.then(() => runChunk(item.shard, item.chunk)),
				Promise.resolve()
			)
		)
	);

	const summary = ruleSummary(report);
	const elapsed = ((Date.now() - startedAt) / MS_PER_SECOND).toFixed(1);
	const header = `eslint report — ${files.length} files, ${totalChunks} chunks, ${elapsed}s\n${'='.repeat(SUMMARY_RULE_WIDTH)}\n`;
	await Bun.write(resolve(cwd, parsed.outFile), header + report + summary);

	console.log(summary);
	console.log(`Full report written to ${parsed.outFile}`);
	if (failedChunks > 0) {
		console.error(
			`✗ Lint failed (${failedChunks}/${totalChunks} chunks) in ${elapsed}s`
		);
		process.exit(1);
	}
	console.log(`✓ Lint passed (${totalChunks} chunks) in ${elapsed}s`);
};

/**
 * Files that differ from `base` plus anything staged/unstaged/untracked —
 * i.e. everything a full lint of `base` has not already verified.
 *
 * Porcelain lines keep their leading whitespace: ` M path` (unstaged) starts
 * with a significant space, and trimming it shifts the 3-char status prefix
 * onto the path itself, silently dropping that file from the set.
 */
export const gitChangedFiles = (cwd: string, base: string | null) => {
	const committed =
		base === null
			? []
			: gitLines(
					[
						'git',
						'diff',
						'--name-only',
						'--diff-filter=ACMR',
						`${base}...HEAD`
					],
					cwd
				);
	const local = gitLines(['git', 'status', '--porcelain'], cwd).map(
		porcelainPath
	);

	return new Set([...committed, ...local]);
};

/**
 * Every file git can see: tracked plus untracked-but-not-ignored. Respects
 * .gitignore, so no hand-rolled ignore list can drift out of sync with it.
 */
export const gitVisibleFiles = (cwd: string) =>
	gitLines(
		['git', 'ls-files', '--cached', '--others', '--exclude-standard'],
		cwd
	);

export const parseChunkedArgs = (args: string[]) => {
	const parsed: ChunkedArgs = {
		changedBase: null,
		changedOnly: false,
		chunkSize: DEFAULT_CHUNK_SIZE,
		globs: [],
		outFile: DEFAULT_REPORT,
		passthrough: [],
		shards: DEFAULT_SHARDS
	};
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === undefined || arg === '--chunked') continue;
		if (arg === '--changed') parsed.changedOnly = true;
		else if (arg.startsWith('--changed='))
			applyChangedBase(parsed, arg.slice('--changed='.length));
		else if (arg === '--changed-base')
			applyChangedBase(parsed, args[++index] ?? null);
		else if (arg === '--out')
			parsed.outFile = args[++index] ?? parsed.outFile;
		else if (arg.startsWith('--out='))
			parsed.outFile = arg.slice('--out='.length);
		else if (arg === '--chunk-size')
			parsed.chunkSize = Number(args[++index]) || DEFAULT_CHUNK_SIZE;
		else if (arg === '--shards')
			parsed.shards = Number(args[++index]) || DEFAULT_SHARDS;
		else if (arg.startsWith('-')) parsed.passthrough.push(arg);
		else parsed.globs.push(arg);
	}

	return parsed;
};

/** The by-rule triage summary: rule id is the last token of each finding. */
export const ruleSummary = (report: string) => {
	const ruleCounts = new Map<string, number>();
	for (const match of report.matchAll(
		/^\s+\d+:\d+\s+(?:error|warning)\s+.*?\s+([@a-z][\w@/-]*)\s*$/gm
	)) {
		const [, rule] = match;
		if (rule !== undefined)
			ruleCounts.set(rule, (ruleCounts.get(rule) ?? 0) + 1);
	}
	const ranked = [...ruleCounts.entries()].sort(
		([, leftCount], [, rightCount]) => rightCount - leftCount
	);
	const total = ranked.reduce((sum, [, count]) => sum + count, 0);
	const body = ranked
		.map(
			([rule, count]) =>
				`  ${String(count).padStart(SUMMARY_COUNT_PAD)}  ${rule}`
		)
		.join('\n');

	return `\n${'='.repeat(SUMMARY_RULE_WIDTH)}\nBY RULE (${total} problems):\n${body}\n`;
};

/** The branch's upstream ref, or null when none is configured. */
export const upstreamRef = (cwd: string) => {
	const [ref] = gitLines(
		[
			'git',
			'rev-parse',
			'--abbrev-ref',
			'--symbolic-full-name',
			'@{upstream}'
		],
		cwd
	);

	return ref ?? null;
};
