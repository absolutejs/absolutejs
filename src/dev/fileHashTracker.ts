import { readFileSync, statSync } from 'node:fs';
import { UNFOUND_INDEX } from '../constants';
import { normalizePath } from '../utils/normalizePath';

const statCache = new Map<string, { mtime: number; size: number }>();
const hashCache = new Map<string, number>();

const isStatUnchanged = (
	normalizedPath: string,
	mtime: number,
	size: number
) => {
	const cached = statCache.get(normalizedPath);
	if (!cached) return false;
	return cached.mtime === mtime && cached.size === size;
};

export const computeFileHash = (filePath: string) => {
	const normalizedPath = normalizePath(filePath);

	try {
		const stat = statSync(filePath);
		const mtime = stat.mtimeMs;
		const size = stat.size;

		if (isStatUnchanged(normalizedPath, mtime, size)) {
			const cachedHash = hashCache.get(normalizedPath);
			if (cachedHash !== undefined) return cachedHash;
		}

		const fileContent = readFileSync(filePath);
		const hash = Number(Bun.hash(fileContent));

		statCache.set(normalizedPath, { mtime, size });
		hashCache.set(normalizedPath, hash);

		return hash;
	} catch {
		return UNFOUND_INDEX;
	}
};

export const hasFileChangedFast = (filePath: string) => {
	const normalizedPath = normalizePath(filePath);

	try {
		const stat = statSync(filePath);
		if (isStatUnchanged(normalizedPath, stat.mtimeMs, stat.size)) {
			return false;
		}

		statCache.set(normalizedPath, {
			mtime: stat.mtimeMs,
			size: stat.size
		});
		return true;
	} catch {
		return true;
	}
};

export const hasFileChanged = (
	filePath: string,
	currentHash: number,
	previousHashes: Map<string, number>
) => {
	const normalizedPath = normalizePath(filePath);
	const previousHash = previousHashes.get(normalizedPath);

	if (previousHash === undefined) return true;

	return previousHash !== currentHash;
};
