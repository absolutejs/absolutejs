import { isTestFile } from './testFiles';
type CacheEntry = {
	content: string;
	imports: string[];
	mtime: number;
};

// Persist across bun --hot reloads so HMR doesn't refetch everything
const cache = globalThis.__transformCache ?? new Map<string, CacheEntry>();
globalThis.__transformCache = cache;

// Reverse map: importedFile → Set<files that import it>
// Used to cascade invalidation up the import chain.
const importers =
	globalThis.__transformImporters ?? new Map<string, Set<string>>();
globalThis.__transformImporters = importers;
const dependencies =
	globalThis.__transformDependencies ?? new Map<string, string[]>();
globalThis.__transformDependencies = dependencies;

// Cache entries are invalidated by invalidateModule() when files
// change — no need to re-stat on every read. If it's in the cache,
// it's valid.
export const getTransformed = (filePath: string) =>
	cache.get(filePath)?.content;

export const setTransformed = (
	filePath: string,
	content: string,
	mtime: number,
	imports?: string[]
) => {
	const resolvedImports = imports ?? [];
	for (const old of dependencies.get(filePath) ?? []) {
		const parents = importers.get(old);
		parents?.delete(filePath);
		if (!parents?.size) importers.delete(old);
	}
	dependencies.set(filePath, resolvedImports);
	cache.set(filePath, { content, imports: resolvedImports, mtime });

	// Update reverse dependency map
	for (const imp of resolvedImports) {
		const set = importers.get(imp) ?? new Set<string>();
		importers.set(imp, set);
		set.add(filePath);
	}
};

// Per-file invalidation version. Incremented when a file's transform
// cache is cleared due to a downstream import changing. Used by
// srcUrl() to force browser re-fetch even if the file's mtime is same.
const invalidationVersions =
	globalThis.__transformInvalidationVersions ?? new Map<string, number>();
globalThis.__transformInvalidationVersions = invalidationVersions;

const isComponentFile = (filePath: string) =>
	filePath.endsWith('.tsx') || filePath.endsWith('.jsx');

/* A test file imports components too, but the browser never loads it:
 * climbing to one made HMR re-import `*.test.tsx`, whose `bun:test` import
 * fails in the browser, so every such edit fell back to a full reload. */
const processParents = (parents: Set<string>, queue: string[]) => {
	const appParents = [...parents].filter((parent) => !isTestFile(parent));
	const component = appParents.find(isComponentFile);
	if (component !== undefined) return component;

	for (const parent of appParents) queue.push(parent);

	return undefined;
};

/** The modules that import `file` directly. */
export const directImporters = (file: string) => [
	...(importers.get(file) ?? [])
];

export const findNearestComponent = (filePath: string) => {
	const visited = new Set<string>();
	const queue = [filePath];

	while (queue.length > 0) {
		const current = queue.shift();
		if (!current) break;
		if (visited.has(current)) continue;
		visited.add(current);

		const parents = importers.get(current);
		if (!parents) continue;

		const found = processParents(parents, queue);
		if (found !== undefined) return found;
	}

	return undefined;
};
export const getInvalidationVersion = (filePath: string) =>
	invalidationVersions.get(filePath) ?? 0;
export const invalidate = (filePath: string) => {
	const visited = new Set<string>();
	const queue: string[] = [filePath];

	while (queue.length > 0) {
		const current = queue.shift();
		if (current === undefined || visited.has(current)) continue;
		visited.add(current);

		cache.delete(current);
		invalidationVersions.set(
			current,
			(invalidationVersions.get(current) ?? 0) + 1
		);

		const parents = importers.get(current);
		if (!parents) continue;
		for (const parent of parents) {
			if (!visited.has(parent)) queue.push(parent);
		}
	}
};
export const invalidateAll = () => {
	cache.clear();
	importers.clear();
	dependencies.clear();
	invalidationVersions.clear();
};
export const transitiveImporters = (file: string) => {
	const files = new Set([file]);
	for (const current of files) {
		for (const parent of importers.get(current) ?? []) files.add(parent);
	}

	return files;
};
