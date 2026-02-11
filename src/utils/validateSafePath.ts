import { resolve, relative } from 'node:path';
import { normalizePath } from './normalizePath';

export const validateSafePath = (targetPath: string, baseDirectory: string) => {
	const absoluteBase = resolve(baseDirectory);
	const absoluteTarget = resolve(baseDirectory, targetPath);
	// Normalize relative path for consistent cross-platform traversal check
	const relativePath = normalizePath(relative(absoluteBase, absoluteTarget));

	if (relativePath.startsWith('../') || relativePath === '..') {
		throw new Error(`Unsafe path: ${targetPath}`);
	}

	return absoluteTarget;
};
