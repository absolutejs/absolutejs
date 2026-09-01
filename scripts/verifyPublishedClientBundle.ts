import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const entryPath = resolve(import.meta.dir, '..', 'dist', 'client', 'index.js');
const source = readFileSync(entryPath, 'utf8');
const FRAMEWORK_HYDRATOR_COUNT = 4;
const optionalFrameworkImports =
	/^import(?:\s|\{)[\s\S]*?from\s+["'](?:react(?:\/[^"']*)?|react-dom(?:\/[^"']*)?|svelte(?:\/[^"']*)?|vue(?:\/[^"']*)?|@angular\/[^"']+)["'];?/gm;

const staticFrameworkImports = source.match(optionalFrameworkImports) ?? [];
if (staticFrameworkImports.length > 0) {
	throw new Error(
		`Published client entry statically imports optional framework peers:\n${staticFrameworkImports.join('\n')}`
	);
}

const relativeDynamicImports = [
	...source.matchAll(/import\(["'](\.[^"']+)["']\)/g)
].flatMap((match) => (match[1] ? [match[1]] : []));

if (relativeDynamicImports.length < FRAMEWORK_HYDRATOR_COUNT) {
	throw new Error(
		`Published client entry must preserve the four framework hydrators as dynamic chunks; found ${relativeDynamicImports.length}.`
	);
}

for (const importPath of relativeDynamicImports) {
	const target = resolve(dirname(entryPath), importPath);
	if (!existsSync(target)) {
		throw new Error(
			`Published client entry references a missing dynamic chunk: ${importPath}`
		);
	}
}

console.log(
	`Published client bundle keeps ${relativeDynamicImports.length} optional framework modules behind dynamic chunks.`
);
