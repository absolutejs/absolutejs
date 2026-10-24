import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { isFile } from '../utils/isFile';

// Inline `@import "rel.css"` / `@import url("rel.css")` statements in a
// Vue <style> block by reading the referenced file and embedding its
// contents. Done before compileStyle so the scoped-class hashing
// applies uniformly across imported content, and so the concatenated
// bundle has no `@import` rules to keep in spec-required order. Bare
// (non-relative) imports are preserved — those resolve through the
// regular CSS loader chain.
export const inlineCssImports = (
	cssContent: string,
	cssFilePath: string,
	visited: Set<string> = new Set()
): string => {
	const resolved = realpathSync(cssFilePath);
	if (visited.has(resolved)) return '';
	visited.add(resolved);

	const importRegex =
		/@import\s+(?:url\(\s*)?(['"])(\.{1,2}\/[^'"]+)\1\s*\)?\s*;?/g;

	return cssContent.replace(importRegex, (match, _quote, relPath) => {
		const importedPath = resolve(dirname(cssFilePath), relPath);
		if (!isFile(importedPath)) return match;
		const importedContent = readFileSync(importedPath, 'utf-8');

		return inlineCssImports(importedContent, importedPath, visited);
	});
};
