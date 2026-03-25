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

// Invalidate a file and all modules that transitively import it.
// This ensures the entire import chain gets re-transpiled with
// fresh ?v= params — like Vite's module graph invalidation.
export const invalidate = (filePath: string) => {
	const queue = [filePath];
	const visited = new Set<string>();

	while (queue.length > 0) {
		const current = queue.pop()!;
		if (visited.has(current)) continue;
		visited.add(current);
		cache.delete(current);

		// Bump version for importers so srcUrl() generates new ?v=
		if (current !== filePath) {
			invalidationVersions.set(
				current,
				(invalidationVersions.get(current) ?? 0) + 1
			);
		}

		const parents = importers.get(current);
		if (parents) {
			for (const parent of parents) {
				queue.push(parent);
			}
		}
	}
};

export const invalidateAll = () => {
	cache.clear();
	importers.clear();
};

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
