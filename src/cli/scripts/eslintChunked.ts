import { existsSync, rmSync } from 'node:fs';
import { totalmem } from 'node:os';
import { relative, resolve } from 'node:path';
import {
	createEslintCacheFingerprint,
	createEslintConfigDigest,
	getCacheLocation,
	prepareEslintCache
} from './eslint';
import {
	cachedCleanFiles,
	lintContextKey,
	markShardCache
} from './eslintCacheProbe';

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
 *  - Files whose clean verdict is already cached (same content, toolchain,
 *    config and arguments) are left out before any process starts, so a
 *    run with nothing new to lint costs seconds, not one process per chunk
 *    (eslintCacheProbe.ts). The report still covers them: a clean verdict
 *    has nothing to report.
 *  - Chunk size adapts to memory: each process reports its peak RSS, and
 *    the next chunk in that lane grows or shrinks toward a share of the
 *    per-process budget (the machine's memory over the concurrency). A
 *    fixed 20-file chunk rebuilt the type program 146 times on onSpark; 100
 *    files in one process took 26 s where 5 of 20 took 109 s.
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
 *   --chunk-size <n>     fixed files per ESLint process (default: adaptive,
 *                        starting at 50 and sized to memory)
 *   --shards <n>         cache shard count (default 4) — changing it
 *                        reshuffles which cache file owns which path
 *   positionals          glob patterns for the lint set; without any, every
 *                        git-visible file with a lintable extension is used
 *
 * Environment: LINT_CONCURRENCY caps parallel chunk processes (default 2).
 */

const INITIAL_CHUNK_SIZE = 50;
const MIN_CHUNK_SIZE = 10;
const MAX_CHUNK_SIZE = 500;
/** Growth per step is capped: peak memory is not linear in chunk size. */
const MAX_GROWTH = 2;
/** Aim each process at this share of its memory budget. */
const TARGET_SHARE = 0.6;
/** The share of the machine's memory lint processes may use together. */
const MACHINE_SHARE = 0.75;
const BYTES_PER_KIB = 1024;
const BYTES_PER_MB = BYTES_PER_KIB * BYTES_PER_KIB;
const BYTES_PER_GB = BYTES_PER_MB * BYTES_PER_KIB;
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

type EslintRunResult = {
	combined: string;
	exitCode: number;
	peakBytes?: number;
};

type ChunkedArgs = {
	changedBase: string | null;
	changedOnly: boolean;
	chunkSize: number | null;
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

/* Each file's shard, by a stable hash of its path. */
const filesByShard = (files: string[], shards: number) => {
	const shardFiles: string[][] = Array.from({ length: shards }, () => []);
	for (const file of files) shardFiles[shardOf(file, shards)]?.push(file);

	return shardFiles;
};

/* The next chunk size for a lane, from the last process's peak memory. */
export const nextChunkSize = (
	size: number,
	peakBytes: number | undefined,
	budgetBytes: number
) => {
	if (!peakBytes || peakBytes <= 0) return size;
	const scaled =
		size * Math.min((budgetBytes * TARGET_SHARE) / peakBytes, MAX_GROWTH);

	return Math.max(
		MIN_CHUNK_SIZE,
		Math.min(MAX_CHUNK_SIZE, Math.round(scaled))
	);
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

	return {
		combined: out + err,
		exitCode,
		peakBytes: proc.resourceUsage()?.maxRSS
	};
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

	const concurrency = Math.max(
		1,
		Number(process.env.LINT_CONCURRENCY) || DEFAULT_CONCURRENCY
	);
	const budgetBytes = Math.min(
		(totalmem() * MACHINE_SHARE) / concurrency,
		CHILD_HEAP_MB * BYTES_PER_MB
	);
	const contextKey = lintContextKey(
		createEslintConfigDigest(cwd),
		parsed.passthrough
	);
	const shardCache = (shard: number) => `${cachePrefix}${shard}`;
	const pendingByShard = filesByShard(files, parsed.shards).map(
		(owned, shard) => {
			const clean = cachedCleanFiles(
				owned,
				shardCache(shard),
				contextKey,
				cwd
			);

			return owned.filter((file) => !clean.has(file));
		}
	);
	const pending = pendingByShard.reduce((sum, list) => sum + list.length, 0);
	console.log(
		`Linting ${files.length} files: ${files.length - pending} have a clean cached verdict, ${pending} to lint ` +
			`(${parsed.chunkSize === null ? 'adaptive chunks' : `chunks of ${parsed.chunkSize}`}, ${parsed.shards} cache shards, concurrency ${concurrency}${parsed.changedOnly ? ', --changed' : ''})`
	);
	// A run that stops part-way leaves a cache mixing contexts: no marker
	// until it finishes, so nothing is skipped on its word.
	for (let shard = 0; shard < parsed.shards; shard++)
		rmSync(resolve(cwd, `${shardCache(shard)}.config`), { force: true });

	const startedAt = Date.now();
	let failedChunks = 0;
	let completedChunks = 0;
	let lintedFiles = 0;
	let report = '';

	const runChunk = async (shard: number, chunk: string[]) => {
		let results = [
			await runEslintProcess(
				chunk,
				shardCache(shard),
				parsed.passthrough,
				cwd
			)
		];
		const crashed = wasSilentCrash(results, chunk);
		if (crashed)
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
		lintedFiles += chunk.length;
		const peak = results[0]?.peakBytes;
		process.stdout.write(
			`  · chunk ${completedChunks}: ${chunk.length} files${peak ? `, peak ${(peak / BYTES_PER_GB).toFixed(1)} GB` : ''} (${lintedFiles}/${pending})\n`
		);
		if (exitCode !== 0) failedChunks++;

		// A crash (out of memory, most often) halves the next chunk.
		return crashed ? undefined : peak;
	};

	/* A lane drains its shards in order, so one shard's cache file is never
	 * written by two processes at once; within a shard, each chunk is sized
	 * from the previous process's peak memory. */
	const sizeAfter = (size: number, peak: number | undefined) => {
		if (parsed.chunkSize !== null) return size;

		return peak === undefined
			? Math.max(MIN_CHUNK_SIZE, Math.floor(size / 2))
			: nextChunkSize(size, peak, budgetBytes);
	};
	const drainShard = async (
		shard: number,
		queue: string[],
		size: number
	): Promise<number> => {
		if (queue.length === 0) return size;
		const peak = await runChunk(shard, queue.slice(0, size));

		return drainShard(shard, queue.slice(size), sizeAfter(size, peak));
	};
	const runLane = (shards: number[]) =>
		shards.reduce(
			async (previous, shard) =>
				drainShard(shard, pendingByShard[shard] ?? [], await previous),
			Promise.resolve(parsed.chunkSize ?? INITIAL_CHUNK_SIZE)
		);
	const laneShards: number[][] = Array.from(
		{ length: concurrency },
		() => []
	);
	for (let shard = 0; shard < parsed.shards; shard++)
		laneShards[shard % concurrency]?.push(shard);
	await Promise.all(laneShards.map(runLane));
	for (let shard = 0; shard < parsed.shards; shard++)
		markShardCache(shardCache(shard), contextKey, cwd);
	const totalChunks = completedChunks;

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
		chunkSize: null,
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
			parsed.chunkSize = Number(args[++index]) || null;
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
