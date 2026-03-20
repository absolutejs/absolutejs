import { statSync } from 'node:fs';

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

export const getTransformed = (filePath: string) => {
	const entry = cache.get(filePath);
	if (!entry) return undefined;

	try {
		const stat = statSync(filePath);
		if (stat.mtimeMs === entry.mtime) return entry.content;
	} catch {
		cache.delete(filePath);
	}

	return undefined;
};

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
