import { statSync } from 'node:fs';

type CacheEntry = {
	content: string;
	mtime: number;
};

const cache = new Map<string, CacheEntry>();

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
