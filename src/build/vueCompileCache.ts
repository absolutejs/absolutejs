/* Restart-surviving cache for `compileVueFile` output.
 *
 * `compileVue` is the dominant cost of a cold dev boot on a large Vue app
 * (tens of seconds of `compileScript` + `compileTemplate` across hundreds
 * of SFCs), and the in-memory `persistentBuildCache` in `compileVue.ts`
 * only helps within one process. This module keeps a self-contained copy
 * of each compiled component under `.absolutejs/compile-cache/vue/` so
 * the next process can re-materialise the intermediates instead of
 * recompiling. It is deliberately independent of
 * `.absolutejs/generated/`, which `cleanup/generated` wipes after every
 * build.
 *
 * Correctness contract — a hit must be byte-identical to a fresh compile:
 *   - the key covers the framework + Vue compiler versions, the style
 *     preprocessor config, the component's own content, its role
 *     (entry/child), its relative path, and the keys of every child
 *     component it imports (so a child edit invalidates all ancestors);
 *   - files `compileScript` reads for cross-file type resolution
 *     (`defineProps<Imported>()`) are recorded with their content hash
 *     and re-verified on every hit;
 *   - components whose `<style>` blocks pull in external files (a
 *     preprocessor `lang`, or `@import`/`@use`/`@forward`) are never
 *     cached, because that CSS depends on content the key cannot see.
 *
 * Opt out with `ABSOLUTE_COMPILE_CACHE=0`. */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ParsedVueSpaRoute } from './parseVueSpaRoutes';

const CACHE_DIR_NAME = 'compile-cache';
const ABSOLUTE_CACHE_DIR_NAME = '.absolutejs';
const CACHE_FORMAT_VERSION = 1;
const FILE_NAME_HASH_LENGTH = 32;

export type VueCompileCacheResult = {
	clientPath: string;
	serverPath: string;
	cssPaths: string[];
	cssCodes: string[];
	tsHelperPaths: string[];
	hmrId: string;
	spaRoutes?: ParsedVueSpaRoute[];
};

export type VueCompileCacheEntry = {
	key: string;
	clientCode: string;
	serverCode: string;
	result: VueCompileCacheResult;
	/** Absolute path → content hash of every file `compileScript` read
	 *  while resolving imported types. Re-verified on read. */
	typeDeps: Record<string, string>;
};

export const vueCompileCacheEnabled = () =>
	process.env.ABSOLUTE_COMPILE_CACHE !== '0';

export const hashContent = (content: string) =>
	createHash('sha256').update(content).digest('hex');

export const hashParts = (parts: readonly string[]) => {
	const hash = createHash('sha256');
	for (const part of parts) {
		hash.update(part);
		hash.update('\0');
	}

	return hash.digest('hex');
};

const readOwnPackageVersion = () => {
	const candidates = [
		resolve(import.meta.dir, '..', '..', 'package.json'),
		resolve(import.meta.dir, '..', 'package.json')
	];
	for (const candidate of candidates) {
		try {
			const pkg = JSON.parse(readFileSync(candidate, 'utf-8')) as {
				name?: string;
				version?: string;
			};
			if (pkg.name === '@absolutejs/absolute' && pkg.version) {
				return pkg.version;
			}
		} catch {
			/* try the next candidate */
		}
	}

	// Read through Reflect so this file needs no ambient global: the Angular
	// typecheck compiles it under the example's config, which does not load
	// the framework's own global declarations.
	const injected: unknown = Reflect.get(globalThis, '__absoluteVersion');

	return typeof injected === 'string' ? injected : null;
};

let cachedFrameworkVersion: string | null | undefined;
export const frameworkVersionForCache = () => {
	cachedFrameworkVersion ??= readOwnPackageVersion();

	return cachedFrameworkVersion;
};

export const vueCompileCacheDir = (projectRoot: string = process.cwd()) =>
	join(projectRoot, ABSOLUTE_CACHE_DIR_NAME, CACHE_DIR_NAME, 'vue');

const entryFileFor = (sourceFilePath: string, projectRoot?: string) =>
	join(
		vueCompileCacheDir(projectRoot),
		`${hashContent(sourceFilePath).slice(0, FILE_NAME_HASH_LENGTH)}.json`
	);

/** Build the environment part of every key: anything that changes the
 *  compiler's output without changing the component's own source. */
export const vueCompileCacheFingerprint = (parts: {
	compilerVersion: string | undefined;
	stylePreprocessors: unknown;
	vueRootDir: string;
	outputDirs: { client: string; server: string; css: string };
}) => {
	const frameworkVersion = frameworkVersionForCache();
	if (!frameworkVersion) return null;

	return hashParts([
		String(CACHE_FORMAT_VERSION),
		frameworkVersion,
		parts.compilerVersion ?? 'unknown-vue-compiler',
		JSON.stringify(parts.stylePreprocessors ?? null),
		parts.vueRootDir,
		parts.outputDirs.client,
		parts.outputDirs.server,
		parts.outputDirs.css
	]);
};

const typeDepsUnchanged = (typeDeps: Record<string, string>) => {
	for (const [path, hash] of Object.entries(typeDeps)) {
		try {
			if (hashContent(readFileSync(path, 'utf-8')) !== hash) return false;
		} catch {
			return false;
		}
	}

	return true;
};

const isEntryShape = (value: unknown): value is VueCompileCacheEntry => {
	if (!value || typeof value !== 'object') return false;
	const entry = value as Partial<VueCompileCacheEntry>;

	return (
		typeof entry.key === 'string' &&
		typeof entry.clientCode === 'string' &&
		typeof entry.serverCode === 'string' &&
		typeof entry.result === 'object' &&
		entry.result !== null &&
		typeof entry.typeDeps === 'object' &&
		entry.typeDeps !== null
	);
};

/** Read a cached compile for `sourceFilePath` if its key matches and every
 *  recorded type dependency is unchanged. Any I/O or shape problem is a
 *  miss — the cache can only ever make a build faster, never wrong. */
export const readVueCompileCacheEntry = (
	sourceFilePath: string,
	key: string,
	projectRoot?: string
) => {
	if (!vueCompileCacheEnabled()) return null;
	const entryFile = entryFileFor(sourceFilePath, projectRoot);
	if (!existsSync(entryFile)) return null;
	try {
		const parsed: unknown = JSON.parse(readFileSync(entryFile, 'utf-8'));
		if (!isEntryShape(parsed) || parsed.key !== key) return null;
		if (!typeDepsUnchanged(parsed.typeDeps)) return null;

		return parsed;
	} catch {
		return null;
	}
};

/** Persist a compile. Written via a temp file + rename so a crash mid-write
 *  can never leave a torn entry for the next process to trust. Async so
 *  hundreds of entry writes never stall the main thread while it is
 *  feeding the build worker pool; callers drain the returned promises
 *  before declaring the compile finished. */
export const writeVueCompileCacheEntry = async (
	sourceFilePath: string,
	entry: VueCompileCacheEntry,
	projectRoot?: string
) => {
	if (!vueCompileCacheEnabled()) return;
	const entryFile = entryFileFor(sourceFilePath, projectRoot);
	try {
		await mkdir(vueCompileCacheDir(projectRoot), { recursive: true });
		const tempFile = `${entryFile}.${process.pid}.tmp`;
		await writeFile(tempFile, JSON.stringify(entry));
		await rename(tempFile, entryFile);
	} catch {
		/* best-effort: a full disk or a read-only checkout just means no
		 * cache next time */
	}
};
