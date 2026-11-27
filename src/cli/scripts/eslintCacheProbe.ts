import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

/**
 * Which files ESLint's own cache already holds a clean verdict for, so the
 * chunked runner can leave them out instead of starting a process per
 * chunk just to read the cache (onSpark: 146 processes, 173 s, with nothing
 * to lint).
 *
 * A file is skipped only when ESLint would itself return its cached result:
 * - its content hash equals the cache entry's (`--cache-strategy content`
 *   stores an MD5 of the file);
 * - the cached result has no errors, warnings or fatal errors (anything
 *   else is linted again, so it is reported);
 * - the lint toolchain is unchanged (`prepareEslintCache` already drops a
 *   shard cache when it changes) and so is the config and the ESLint
 *   arguments: recorded next to each shard cache after a run, because
 *   ESLint keys an entry on the calculated config and we can't recompute
 *   that hash without its internals.
 *
 * Anything uncertain (no marker, an unreadable cache, `flatted` not found)
 * means no skipping, never a wrong skip.
 *
 * The verdict cache is the runner's, not any one ESLint process's: each
 * process lints with its own scratch cache, and its entries are merged in
 * afterwards (`mergeVerdicts`). So any file can go to any process, and a
 * file only ever has one verdict, its newest.
 */

type CachedVerdict = { clean: boolean; hash: string };

const markerPath = (cacheLocation: string) => `${cacheLocation}.config`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object';

type Flatted = {
	parse: (text: string) => unknown;
	stringify: (value: unknown) => string;
};

/* The `flatted` ESLint writes its cache with, reached through its own
 * dependency chain (eslint → file-entry-cache → flat-cache → flatted). */
const loadFlatted = (cwd: string) => {
	try {
		const fromEslint = createRequire(
			resolve(cwd, 'node_modules/eslint/package.json')
		);
		const fromEntryCache = createRequire(
			fromEslint.resolve('file-entry-cache')
		);
		const fromFlatCache = createRequire(
			fromEntryCache.resolve('flat-cache')
		);
		const flatted: unknown = fromFlatCache('flatted');
		if (!isRecord(flatted)) return null;
		const { parse, stringify } = flatted;
		if (typeof parse !== 'function' || typeof stringify !== 'function')
			return null;

		const loaded: Flatted = {
			parse: (text: string) => {
				const parsed: unknown = parse(text);

				return parsed;
			},
			stringify: (value: unknown) => String(stringify(value))
		};

		return loaded;
	} catch {
		return null;
	}
};

const readEntries = (path: string, flatted: Flatted) => {
	if (!existsSync(path)) return {};
	const cache = flatted.parse(readFileSync(path, 'utf-8'));

	return isRecord(cache) ? cache : {};
};

const isClean = (results: unknown) =>
	isRecord(results) &&
	results.errorCount === 0 &&
	results.warningCount === 0 &&
	results.fatalErrorCount === 0;

const readVerdicts = (cacheLocation: string, cwd: string) => {
	const verdicts = new Map<string, CachedVerdict>();
	const flatted = loadFlatted(cwd);
	if (!flatted) return verdicts;
	let cache: Record<string, unknown>;
	try {
		cache = readEntries(resolve(cwd, cacheLocation), flatted);
	} catch {
		return verdicts;
	}
	for (const [file, entry] of Object.entries(cache)) {
		if (!isRecord(entry) || typeof entry.hash !== 'string') continue;
		verdicts.set(file, { clean: isClean(entry.results), hash: entry.hash });
	}

	return verdicts;
};

/** The files whose cached verdict is clean and still applies. */
export const cachedCleanFiles = (
	files: string[],
	cacheLocation: string,
	contextKey: string,
	cwd: string
) => {
	const marker = resolve(cwd, markerPath(cacheLocation));
	if (
		!existsSync(marker) ||
		readFileSync(marker, 'utf-8').trim() !== contextKey
	)
		return new Set<string>();
	const verdicts = readVerdicts(cacheLocation, cwd);
	const clean = new Set<string>();
	for (const file of files) {
		const absolute = resolve(cwd, file);
		const verdict = verdicts.get(absolute);
		if (!verdict?.clean || !existsSync(absolute)) continue;
		const hash = createHash('md5')
			.update(readFileSync(absolute))
			.digest('hex');
		if (hash === verdict.hash) clean.add(file);
	}

	return clean;
};

/** What the verdicts depend on beyond the toolchain: the config digest
 *  and the ESLint arguments the run passed. */
export const lintContextKey = (configDigest: string, passthrough: string[]) =>
	createHash('sha256')
		.update(configDigest)
		.update('\0')
		.update(JSON.stringify(passthrough))
		.digest('hex');

/** Record that the verdict cache was written under `contextKey`. */
export const markVerdictCache = (
	cacheLocation: string,
	contextKey: string,
	cwd: string
) => writeFileSync(resolve(cwd, markerPath(cacheLocation)), `${contextKey}\n`);

/**
 * Copy one process's cache entries into the verdict cache, replacing any
 * older verdict for the same file. Written to a temporary file and renamed,
 * so a run that stops mid-write leaves the previous cache whole. False when
 * either cache can't be read: those files are simply linted again.
 */
export const mergeVerdicts = (
	fromCache: string,
	intoCache: string,
	cwd: string
) => {
	const flatted = loadFlatted(cwd);
	if (!flatted) return false;
	try {
		const merged: Record<string, unknown> = {
			...readEntries(resolve(cwd, intoCache), flatted),
			...readEntries(resolve(cwd, fromCache), flatted)
		};
		const target = resolve(cwd, intoCache);
		const temporary = `${target}.${process.pid}.tmp`;
		writeFileSync(temporary, flatted.stringify(merged));
		renameSync(temporary, target);

		return true;
	} catch {
		return false;
	}
};
