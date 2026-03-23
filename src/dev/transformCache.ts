type CacheEntry = {
	content: string;
	mtime: number;
};

// Persist across bun --hot reloads so HMR doesn't refetch everything
const globalStore = globalThis as unknown as Record<
	string,
	Map<string, CacheEntry> | undefined
>;
const cache: Map<string, CacheEntry> =
	globalStore.__transformCache ?? new Map<string, CacheEntry>();
globalStore.__transformCache = cache;

// Cache entries are invalidated by invalidateModule() when files
// change — no need to re-stat on every read. If it's in the cache,
// it's valid.
export const getTransformed = (filePath: string) =>
	cache.get(filePath)?.content;

export const setTransformed = (
	filePath: string,
	content: string,
	mtime: number
) => {
	cache.set(filePath, { content, mtime });
};

export const invalidate = (filePath: string) => {
	cache.delete(filePath);
};

export const invalidateAll = () => {
	cache.clear();
};
