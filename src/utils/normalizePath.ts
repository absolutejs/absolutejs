/**
 * Normalize file paths to use forward slashes for cross-platform compatibility.
 * Windows uses backslashes, but this codebase standardizes on forward slashes.
 */
export const normalizePath = (path: string): string => path.replace(/\\/g, '/');

/**
 * Normalize all paths in an array.
 */
export const normalizePaths = (paths: string[]): string[] =>
	paths.map(normalizePath);
