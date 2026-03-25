import { resolve } from 'node:path';

type CacheEntry = {
	content: string;
	imports: string[];
	mtime: number;
};

// Persist across bun --hot reloads so HMR doesn't refetch everything
const globalStore = globalThis as unknown as Record<string, unknown>;
const cache =
	(globalStore.__transformCache as Map<string, CacheEntry> | undefined) ??
	new Map<string, CacheEntry>();
globalStore.__transformCache = cache;

// Reverse map: importedFile → Set<files that import it>
// Used to cascade invalidation up the import chain.
const importers =
	(globalStore.__transformImporters as Map<string, Set<string>> | undefined) ??
	new Map<string, Set<string>>();
globalStore.__transformImporters = importers;

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
	cache.set(filePath, { content, imports: resolvedImports, mtime });

	// Update reverse dependency map
	for (const imp of resolvedImports) {
		if (!importers.has(imp)) {
			importers.set(imp, new Set());
		}
		importers.get(imp)!.add(filePath);
	}
};

// Per-file invalidation version. Incremented when a file's transform
// cache is cleared due to a downstream import changing. Used by
// srcUrl() to force browser re-fetch even if the file's mtime is same.
const invalidationVersions =
	(globalStore.__transformInvalidationVersions as Map<string, number> | undefined) ??
	new Map<string, number>();
globalStore.__transformInvalidationVersions = invalidationVersions;

export const getInvalidationVersion = (filePath: string) =>
	invalidationVersions.get(filePath) ?? 0;

// Invalidate a file and its direct importers (one level up).
// The direct importers need re-transpilation so their import of
// the changed file gets a fresh ?v= param.
export const invalidate = (filePath: string) => {
	cache.delete(filePath);

	// Bump the CHANGED file's version so when importers are
	// re-transpiled, srcUrl() generates a new ?v= for it.
	invalidationVersions.set(
		filePath,
		(invalidationVersions.get(filePath) ?? 0) + 1
	);

	// Clear transform cache for direct importers so they get
	// re-transpiled with the changed file's new ?v= param.
	const parents = importers.get(filePath);
	if (parents) {
		for (const parent of parents) {
			cache.delete(parent);
		}
	}
};

export const invalidateAll = () => {
	cache.clear();
	importers.clear();
};

// Track which files use the mutable HMR data store wrapper.
// Used by the module server to rewrite named imports from these
// files into destructured reads from the store object.
const dataFiles =
	(globalStore.__transformDataFiles as Set<string> | undefined) ??
	new Set<string>();
globalStore.__transformDataFiles = dataFiles;

export const markAsDataFile = (filePath: string) => {
	dataFiles.add(filePath);
};

export const isDataFile = (filePath: string) => dataFiles.has(filePath);

// Walk up the runtime import graph to find the nearest component
// (.tsx/.jsx) that imports this file. Returns the component path,
// or undefined if none found. Used so HMR can re-import just the
// nearest boundary instead of the entire page tree.
export const findNearestComponent = (filePath: string) => {
	const visited = new Set<string>();
	const queue = [filePath];

	while (queue.length > 0) {
		const current = queue.shift()!;
		if (visited.has(current)) continue;
		visited.add(current);

		const parents = importers.get(current);
		if (!parents) continue;
		for (const parent of parents) {
			if (parent.endsWith('.tsx') || parent.endsWith('.jsx')) {
				return parent;
			}
			queue.push(parent);
		}
	}

	return undefined;
};
