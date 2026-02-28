import { readFileSync } from 'node:fs';
import { normalizePath } from '../utils/normalizePath';

/* Bun.hash (Wyhash) returns a number — comparing numbers is faster
   than comparing strings and avoids the .toString() allocation. We
   use -1 as the "file unreadable" sentinel (impossible hash value). */
export const computeFileHash = (filePath: string) => {
	try {
		const fileContent = readFileSync(filePath);

		return Number(Bun.hash(fileContent));
	} catch {
		return -1;
	}
};

/* This function checks if the file has changed by comparing its
   current hash to the previous hash
   this handles the detection of actual changes */
export const hasFileChanged = (
	filePath: string,
	currentHash: number,
	previousHashes: Map<string, number>
) => {
	// Normalize path for consistent Map key lookup across platforms
	const normalizedPath = normalizePath(filePath);
	const previousHash = previousHashes.get(normalizedPath);

	if (previousHash === undefined) {
		// First time seeing this file, definitely changed
		return true;
	}

	return previousHash !== currentHash;
};
