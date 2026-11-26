import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
 */

type CachedVerdict = { clean: boolean; hash: string };

const markerPath = (cacheLocation: string) => `${cacheLocation}.config`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object';

/* The `flatted` ESLint writes its cache with, reached through its own
 * dependency chain (eslint → file-entry-cache → flat-cache → flatted). */
const loadFlattedParse = (cwd: string) => {
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
		const parse = isRecord(flatted) ? flatted.parse : undefined;

		if (typeof parse !== 'function') return null;
		const parseCache = (text: string) => {
			const parsed: unknown = parse(text);

			return parsed;
		};

		return parseCache;
	} catch {
		return null;
	}
};

const isClean = (results: unknown) =>
	isRecord(results) &&
	results.errorCount === 0 &&
	results.warningCount === 0 &&
	results.fatalErrorCount === 0;

const readVerdicts = (cacheLocation: string, cwd: string) => {
	const verdicts = new Map<string, CachedVerdict>();
	const path = resolve(cwd, cacheLocation);
	const parse = loadFlattedParse(cwd);
	if (!parse || !existsSync(path)) return verdicts;
	let cache: unknown;
	try {
		cache = parse(readFileSync(path, 'utf-8'));
	} catch {
		return verdicts;
	}
	if (!isRecord(cache)) return verdicts;
	for (const [file, entry] of Object.entries(cache)) {
		if (!isRecord(entry) || typeof entry.hash !== 'string') continue;
		verdicts.set(file, { clean: isClean(entry.results), hash: entry.hash });
	}

	return verdicts;
};

/** The files of a shard whose cached verdict is clean and still applies. */
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

/** What a shard cache's verdicts depend on beyond the toolchain: the
 *  config digest and the ESLint arguments the run passed. */
export const lintContextKey = (configDigest: string, passthrough: string[]) =>
	createHash('sha256')
		.update(configDigest)
		.update('\0')
		.update(JSON.stringify(passthrough))
		.digest('hex');

/** Record that a shard cache was written under `contextKey`. */
export const markShardCache = (
	cacheLocation: string,
	contextKey: string,
	cwd: string
) => writeFileSync(resolve(cwd, markerPath(cacheLocation)), `${contextKey}\n`);
