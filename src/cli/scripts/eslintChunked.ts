import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir, totalmem } from 'node:os';
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
	markVerdictCache,
	mergeVerdicts
} from './eslintCacheProbe';
import {
	chunkSizeFor,
	fileKind,
	loadObservations,
	saveObservations
} from './eslintMemoryModel';

/**
 * Chunked, cache-fingerprinted ESLint orchestration for projects whose
 * type-aware lint program is expensive to build and too big for one process.
 *
 * Why this exists: with heavy typed surfaces (e.g. Drizzle row types flowing
 * through a full Eden `Server`), a single whole-repo ESLint pass can exceed
 * the V8 heap. Files run in a few separate processes instead, each as large
 * as memory allows, because every process pays to build the TypeScript
 * program again (onSpark: about 26 s of a 59 s, 209-file process).
 *
 * Layers:
 *  - One verdict cache. Each process lints with its own scratch ESLint cache
 *    (`--cache-strategy content`, so mtime churn never invalidates a clean
 *    verdict) and its entries are merged into the verdict cache when it
 *    finishes (eslintCacheProbe.ts). Any file can go to any process, and a
 *    file only ever has its newest verdict.
 *  - The verdict cache is guarded by the toolchain fingerprint
 *    (`prepareEslintCache`): the INSTALLED manifests of every lint-related
 *    dependency. Plugin upgrades, or node_modules drifting from the
 *    lockfile, drop it instead of silently reusing stale verdicts.
 *  - Files whose clean verdict is cached (same content, toolchain, config
 *    and arguments) are left out before any process starts, so a run with
 *    nothing new to lint costs seconds and a small change is one process.
 *    The report still covers them: a clean verdict has nothing to report.
 *  - Chunk size comes from memory: every process reports its peak RSS, and
 *    a line through (files, peak) gives the size that peaks near a share of
 *    the per-process budget (available memory over the processes running).
 *    Observations persist between runs (eslintMemoryModel.ts). Lanes take
 *    sorted chunks from one shared queue; a crash caps later chunks at half
 *    the crashed size.
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
 *   --chunk-size <n>     fixed files per ESLint process (default: sized to
 *                        memory)
 *   positionals          glob patterns for the lint set; without any, every
 *                        git-visible file with a lintable extension is used
 *
 * Environment: LINT_CONCURRENCY caps parallel chunk processes (default 2).
 */

const INITIAL_CHUNK_SIZE = 50;
const MIN_CHUNK_SIZE = 10;
const MAX_CHUNK_SIZE = 2000;
const NOT_FOUND = -1;
/** Aim each process at this share of its memory budget. */
const TARGET_SHARE = 0.8;
/** The share of the machine's available memory lint processes may use
 *  together. */
const MACHINE_SHARE = 0.85;
const BYTES_PER_KIB = 1024;
const BYTES_PER_MB = BYTES_PER_KIB * BYTES_PER_KIB;
const BYTES_PER_GB = BYTES_PER_MB * BYTES_PER_KIB;
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_REPORT = '.absolutejs/lint-report.txt';
const CHILD_HEAP_MB = 4096;
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

/* Memory the lint processes can use: what Linux reports as available
 * (free plus reclaimable cache), or a share of the total elsewhere. */
const availableMemory = () => {
	try {
		const line = readFileSync('/proc/meminfo', 'utf-8')
			.split('\n')
			.find((entry) => entry.startsWith('MemAvailable:'));
		const kib = Number(line?.match(/\d+/)?.[0]);
		if (kib > 0) return kib * BYTES_PER_KIB;
	} catch {
		// Not Linux: fall through to the total.
	}

	return totalmem();
};

/* Before one verdict cache, files were split across fixed path-hash shard
 * caches; those files are no longer read. */
const LEGACY_SHARD_LIMIT = 64;
const removeShardCaches = (cacheBase: string, cwd: string) => {
	for (let shard = 0; shard < LEGACY_SHARD_LIMIT; shard++) {
		const shardCache = resolve(cwd, `${cacheBase}-shard-${shard}`);
		if (!existsSync(shardCache) && !existsSync(`${shardCache}.fingerprint`))
			continue;
		for (const suffix of ['', '.config', '.fingerprint'])
			rmSync(`${shardCache}${suffix}`, { force: true, recursive: true });
	}
};

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

	// The toolchain fingerprint guards the verdict cache: a changed lint
	// toolchain (plugin upgrade, drifted node_modules) drops it.
	const cacheBase = getCacheLocation(args);
	const verdictCache = `${cacheBase}-verdicts`;
	removeShardCaches(cacheBase, cwd);
	prepareEslintCache({
		cacheLocation: relative(cwd, resolve(cwd, verdictCache)),
		cwd,
		fingerprint: createEslintCacheFingerprint(cwd)
	});

	const contextKey = lintContextKey(
		createEslintConfigDigest(cwd),
		parsed.passthrough
	);
	const clean = cachedCleanFiles(files, verdictCache, contextKey, cwd);
	// Grouped by kind (a chunk is one kind, sized by that kind's memory),
	// then by path, so a chunk holds neighbouring files that share most of
	// their slice of the type graph.
	const queue = files
		.filter((file) => !clean.has(file))
		.sort(
			(left, right) =>
				fileKind(left).localeCompare(fileKind(right)) ||
				left.localeCompare(right)
		);
	const pending = queue.length;

	const memoryLocation = `${cacheBase}-memory.json`;
	const observations = loadObservations(memoryLocation, cwd);
	const concurrency = Math.max(
		1,
		Number(process.env.LINT_CONCURRENCY) || DEFAULT_CONCURRENCY
	);
	// Measured once, before any lint process runs: read live, a running
	// lane's own memory counted against the next chunk and cut it to the
	// minimum.
	const memoryAtStart = availableMemory();
	const budgetBytes = (lanes: number) =>
		Math.min(
			(memoryAtStart * MACHINE_SHARE) / lanes,
			CHILD_HEAP_MB * BYTES_PER_MB
		);
	// Lowered by a crash; until then the model alone decides.
	let crashCeiling = Number.POSITIVE_INFINITY;
	const sizeFor = (lanes: number, kind: string) =>
		parsed.chunkSize ??
		Math.min(
			crashCeiling,
			chunkSizeFor(
				observations,
				kind,
				budgetBytes(lanes) * TARGET_SHARE,
				{
					initial: INITIAL_CHUNK_SIZE,
					max: MAX_CHUNK_SIZE,
					min: MIN_CHUNK_SIZE
				}
			)
		);
	/* The next chunk: files of the first queued file's kind, up to that
	 * kind's size. Taken synchronously, so two lanes never share files. */
	const takeChunk = (lanes: number) => {
		const kind = fileKind(queue[0] ?? '');
		const size = sizeFor(lanes, kind);
		const end = queue.findIndex(
			(file, index) => index >= size || fileKind(file) !== kind
		);

		return {
			chunk: queue.splice(0, end === NOT_FOUND ? queue.length : end),
			kind
		};
	};
	// No more lanes than there are chunks: a small change is one process.
	const lanes = Math.max(
		1,
		Math.min(
			concurrency,
			Math.ceil(pending / sizeFor(concurrency, fileKind(queue[0] ?? '')))
		)
	);
	console.log(
		`Linting ${files.length} files: ${files.length - pending} have a clean cached verdict, ${pending} to lint ` +
			`(${parsed.chunkSize === null ? 'chunks sized to memory' : `chunks of ${parsed.chunkSize}`}, ${lanes} ${lanes === 1 ? 'process' : 'processes'} at a time${parsed.changedOnly ? ', --changed' : ''})`
	);
	// A run that stops part-way leaves a cache mixing contexts: no marker
	// until it finishes, so nothing is skipped on its word.
	rmSync(resolve(cwd, `${verdictCache}.config`), { force: true });

	const startedAt = Date.now();
	let failedChunks = 0;
	let completedChunks = 0;
	let lintedFiles = 0;
	let report = '';
	const scratchDirectory = mkdtempSync(resolve(tmpdir(), 'absolute-lint-'));

	const runChunk = async (chunk: string[], kind: string) => {
		const scratchCache = resolve(
			scratchDirectory,
			`cache-${completedChunks}-${chunk.length}-${Date.now()}`
		);
		let results = [
			await runEslintProcess(chunk, scratchCache, parsed.passthrough, cwd)
		];
		const crashed = wasSilentCrash(results, chunk);
		if (crashed)
			results = await retryEachFile(chunk, parsed.passthrough, cwd);
		else mergeVerdicts(scratchCache, verdictCache, cwd);
		rmSync(scratchCache, { force: true });
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
			`  · chunk ${completedChunks}: ${chunk.length} ${kind} files${peak ? `, peak ${(peak / BYTES_PER_GB).toFixed(1)} GB` : ''} (${lintedFiles}/${pending})\n`
		);
		if (exitCode !== 0) failedChunks++;
		// A crash (out of memory, most often) caps every later chunk at
		// half its size; a finished process teaches the model.
		if (crashed)
			crashCeiling = Math.max(
				MIN_CHUNK_SIZE,
				Math.floor(chunk.length / 2)
			);
		else if (peak)
			observations.push({ files: chunk.length, kind, peakBytes: peak });
	};

	/* Lanes take the next chunk from one shared queue, each sized from
	 * everything learned so far. Taking is synchronous, so two lanes never
	 * get the same files. */
	const runLane = async (): Promise<void> => {
		const { chunk, kind } = takeChunk(lanes);
		if (chunk.length === 0) return;
		await runChunk(chunk, kind);
		await runLane();
	};
	try {
		await Promise.all(Array.from({ length: lanes }, runLane));
	} finally {
		rmSync(scratchDirectory, { force: true, recursive: true });
	}
	markVerdictCache(verdictCache, contextKey, cwd);
	saveObservations(memoryLocation, observations, cwd);
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
		passthrough: []
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
