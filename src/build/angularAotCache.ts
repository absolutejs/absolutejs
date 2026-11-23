/* Persistent cache for Angular AOT output.
 *
 * Measured on the example app before building this: `performCompilation`
 * costs ~744ms of a ~2.3s production build, and it is the largest single
 * cost that nothing caches — the Angular linker and resource caches already
 * persist (they are NOT dev-only, whatever plan item 5.19 says), and they
 * take the vendor passes from ~790ms to ~144ms, but neither touches the
 * compile itself.
 *
 * Why a whole-program cache rather than a per-file one: `compileAngularFiles`
 * runs ONE `performCompilation` over every entry point, so there is no
 * per-file compile to cache. The unit is the whole emit, all or nothing.
 *
 * What makes it safe to key. The program reads 609 files on this app, 603 of
 * them in `node_modules` — and hashing all of them costs 16ms against the
 * 744ms it saves, a 46x margin, so the cache validates by hashing EVERY file
 * the compiler actually read rather than guessing at a subset. The file list
 * cannot be known before compiling, so it is recorded during a compile and
 * re-checked on the next one; that is sound because any file newly pulled
 * into the program must be imported by some file already in it, whose
 * content therefore changed.
 *
 * The one thing a naive version would get wrong: the compiler does not read
 * the project's own sources from disk. It is handed `transformedSources` —
 * resource-inlined versions with the component's template and styles already
 * substituted — through `getSourceFile`, bypassing `readFile` entirely. A
 * key built from file contents on disk would therefore not change when a
 * template changed, and the cache would serve a component compiled against
 * the old HTML. Hashing EFFECTIVE content (the transformed source where
 * there is one, the file otherwise) is what closes that, and it folds
 * template and style changes in automatically.
 *
 * Everything here fails open: any inconsistency, parse failure or missing
 * file means a miss and a normal compile. `ABSOLUTE_AOT_CACHE=0` disables
 * it outright. */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

const CACHE_ROOT = join('.absolutejs', 'cache', 'angular-aot');
/* Bump when the shape of an entry, or the meaning of the key, changes. An
 * entry written by an older format is never read. */
const CACHE_FORMAT_VERSION = 1;
const KEY_LENGTH = 32;
const LOCKFILES = [
	'bun.lock',
	'bun.lockb',
	'package-lock.json',
	'pnpm-lock.yaml',
	'yarn.lock'
];

export type AotCacheOutput = {
	/** Relative to the compile's `outDir`, so a cache entry does not pin the
	 *  absolute path it was built at. */
	path: string;
	content: string;
};

type AotCacheEntry = {
	formatVersion: number;
	/** Every file the compiler read, by effective-content hash. */
	files: Record<string, string>;
	outputs: AotCacheOutput[];
};

const hash = (value: string) =>
	createHash('sha256').update(value).digest('hex');

export const aotCacheEnabled = () =>
	process.env.ABSOLUTE_AOT_CACHE !== '0' &&
	process.env.ABSOLUTE_AOT_CACHE !== 'false';

/** The content the compiler would see for a file: the resource-inlined
 *  source when there is one, the file on disk otherwise. Hashing anything
 *  else lets a template change slip past the key. */
const effectiveContent = (
	path: string,
	transformedSources: ReadonlyMap<string, string>
) => {
	const transformed = transformedSources.get(resolve(path));
	if (transformed !== undefined) return transformed;
	try {
		return readFileSync(path, 'utf8');
	} catch {
		/* Read as a miss rather than an error: a file the last compile saw
		 * and this one cannot is exactly a reason not to reuse its output. */
		return undefined;
	}
};

const lockfileFingerprint = () => {
	for (const name of LOCKFILES) {
		if (!existsSync(name)) continue;
		try {
			return `${name}:${hash(readFileSync(name, 'utf8'))}`;
		} catch {
			return `${name}:unreadable`;
		}
	}

	return 'no-lockfile';
};

export type AotCacheKeyInput = {
	/** Absolute entry-point paths, in the order given to the compiler. */
	entryPoints: readonly string[];
	/** A stable string for the compiler options actually used. */
	optionsFingerprint: string;
	transformedSources: ReadonlyMap<string, string>;
};

/** Selects WHICH cache entry to consider. The entry then carries the file
 *  list that decides whether it is still valid, so this only has to cover
 *  what the compiler is being ASKED to do: which entries, with what
 *  options, against which installed dependency tree. */
export const aotCacheKey = ({
	entryPoints,
	optionsFingerprint,
	transformedSources
}: AotCacheKeyInput) => {
	const entrySignature = [...entryPoints]
		.map((entry) => resolve(entry))
		.sort()
		.map((entry) => {
			const content = effectiveContent(entry, transformedSources);

			return `${relative(process.cwd(), entry)}\u0000${content === undefined ? 'missing' : hash(content)}`;
		})
		.join('\u0000');

	return hash(
		[
			`v${CACHE_FORMAT_VERSION}`,
			entrySignature,
			optionsFingerprint,
			lockfileFingerprint()
		].join('\u0000')
	).slice(0, KEY_LENGTH);
};

const entryPath = (key: string) => join(CACHE_ROOT, `${key}.json`);

/** The cached outputs when every file the last compile read still hashes
 *  the same, otherwise nothing. */
export const readAotCache = async (
	key: string,
	transformedSources: ReadonlyMap<string, string>
) => {
	if (!aotCacheEnabled()) return undefined;
	let entry: AotCacheEntry;
	try {
		entry = JSON.parse(await readFile(entryPath(key), 'utf8'));
	} catch {
		return undefined;
	}
	if (
		entry.formatVersion !== CACHE_FORMAT_VERSION ||
		typeof entry.files !== 'object' ||
		!Array.isArray(entry.outputs)
	)
		return undefined;

	for (const [path, expected] of Object.entries(entry.files)) {
		const content = effectiveContent(path, transformedSources);
		if (content === undefined || hash(content) !== expected)
			return undefined;
	}

	return entry.outputs;
};

export const writeAotCache = async (
	key: string,
	programFiles: Iterable<string>,
	transformedSources: ReadonlyMap<string, string>,
	outputs: readonly AotCacheOutput[]
) => {
	if (!aotCacheEnabled()) return;
	const files: Record<string, string> = {};
	for (const path of programFiles) {
		const content = effectiveContent(path, transformedSources);
		/* A file that cannot be read now would invalidate this entry on
		 * every later build, so there is no point writing one. */
		if (content === undefined) return;
		files[path] = hash(content);
	}

	const entry: AotCacheEntry = {
		files,
		formatVersion: CACHE_FORMAT_VERSION,
		outputs: [...outputs]
	};
	const target = entryPath(key);
	/* Written beside the target and renamed, so a build that dies midway
	 * cannot leave a half-written entry for the next one to trust. */
	const staging = `${target}.${process.pid}.tmp`;
	try {
		await mkdir(dirname(target), { recursive: true });
		await writeFile(staging, JSON.stringify(entry));
		await rename(staging, target);
	} catch {
		await rm(staging, { force: true }).catch(() => undefined);
	}
};
