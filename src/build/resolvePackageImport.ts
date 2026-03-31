import { resolve, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

/**
 * Resolve a bare module import (e.g. "@absolutejs/absolute/svelte/components/Image.svelte")
 * to an absolute file path by reading the package's exports map in package.json.
 *
 * Returns the resolved absolute path, or null if the import can't be resolved.
 */
export const resolvePackageImport = (specifier: string) => {
	// Only handle bare module imports (not relative or absolute paths)
	if (specifier.startsWith('.') || specifier.startsWith('/')) return null;

	// Split into package name and subpath
	const parts = specifier.split('/');
	const isScoped = specifier.startsWith('@');
	const packageName = isScoped ? `${parts[0]}/${parts[1]}` : parts[0];
	const subpath = isScoped ? parts.slice(2).join('/') : parts.slice(1).join('/');
	const exportKey = subpath ? `./${subpath}` : '.';

	// Find package.json
	const packageDir = resolve(process.cwd(), 'node_modules', packageName ?? '');
	const packageJsonPath = join(packageDir, 'package.json');

	if (!existsSync(packageJsonPath)) return null;

	try {
		const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
		const {exports} = packageJson;

		if (!exports) return null;

		// Try exact match first, then try without extension for .svelte/.vue files
		const entry = exports[exportKey];

		if (!entry) return null;

		let importPath: string | null = null;
		if (typeof entry === 'string') importPath = entry;
		else if (typeof entry === 'object' && entry.import) importPath = entry.import;

		if (!importPath) return null;

		const resolved = resolve(packageDir, importPath);

		return existsSync(resolved) ? resolved : null;
	} catch {
		return null;
	}
};
