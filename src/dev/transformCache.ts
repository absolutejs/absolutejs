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

const processParents = (parents: Set<string>, queue: string[]) => {
	const component = [...parents].find(isComponentFile);
	if (component !== undefined) return component;

	for (const parent of parents) queue.push(parent);

	return undefined;
};

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
/**
 * Invalidate `filePath` and every transitive importer.
 *
 * BFS up the reverse-import graph; for each visited file we (1) drop
 * its transform cache so the next request re-transpiles, and (2) bump
 * its invalidation version so `srcUrl()` emits a fresh `?v=` token —
 * forcing the browser to refetch even when the importer's mtime is
 * unchanged. Bumping versions on transitive importers (not just the
 * originally-changed file) is the load-bearing piece: without it, a
 * page that imports a service via two intermediate components keeps
 * resolving the page module under its old `?v=`, the page bundle's
 * internal `/@src/` references stay pointed at stale URLs, and rapid
 * HMR cycles wedge the browser bundle until the dev server restarts.
 *
 * Cycles are tolerated via the `visited` set.
 */
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
	invalidationVersions.clear();
};
