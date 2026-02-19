import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { build as bunBuild } from 'bun';

/** Bare specifiers that need stable vendor builds */
const reactSpecifiers = [
	'react',
	'react-dom',
	'react-dom/client',
	'react/jsx-runtime',
	'react/jsx-dev-runtime'
];

/** Convert a bare specifier to a safe filename: react-dom/client → react-dom_client */
const toSafeFileName = (specifier: string): string =>
	specifier.replace(/\//g, '_');

/** Compute the deterministic vendor paths mapping (no build needed).
 *  This can be called before vendor files exist on disk. */
export const computeVendorPaths = (): Record<string, string> => {
	const paths: Record<string, string> = {};
	for (const specifier of reactSpecifiers) {
		paths[specifier] = `/react/vendor/${toSafeFileName(specifier)}.js`;
	}

	return paths;
};

/** Introspect a package's exports at runtime and generate an entry file
 *  with explicit named re-exports. This is necessary because React is a
 *  CJS module — `export * from 'react'` can't statically determine the
 *  export names, so Bun produces an empty re-export. */
const generateEntrySource = async (specifier: string): Promise<string> => {
	const mod = await import(specifier);
	const exportNames = Object.keys(mod).filter(
		(key) => key !== 'default' && key !== '__esModule'
	);

	const lines: string[] = [];
	if (exportNames.length > 0) {
		lines.push(`export { ${exportNames.join(', ')} } from '${specifier}';`);
	}
	if ('default' in mod) {
		lines.push(`export { default } from '${specifier}';`);
	}

	return lines.join('\n') + '\n';
};

/** Build React packages into stable vendor files (no content hash).
 *  Output goes to {buildDir}/react/vendor/ with predictable names like
 *  react.js, react-dom_client.js, etc. These files never change between
 *  rebuilds, so the browser always loads React from a single source. */
export const buildReactVendor = async (buildDir: string): Promise<void> => {
	const vendorDir = join(buildDir, 'react', 'vendor');
	mkdirSync(vendorDir, { recursive: true });

	const tmpDir = join(buildDir, '_vendor_tmp');
	mkdirSync(tmpDir, { recursive: true });

	// Create temp entry files with explicit named exports
	const entrypoints: string[] = [];
	for (const specifier of reactSpecifiers) {
		const safeName = toSafeFileName(specifier);
		const entryPath = join(tmpDir, `${safeName}.ts`);
		const source = await generateEntrySource(specifier);
		await Bun.write(entryPath, source);
		entrypoints.push(entryPath);
	}

	const result = await bunBuild({
		entrypoints,
		format: 'esm',
		minify: false,
		naming: '[name].[ext]',
		outdir: vendorDir,
		splitting: true,
		target: 'browser',
		throw: false
	});

	await rm(tmpDir, { force: true, recursive: true });

	if (!result.success) {
		console.warn('⚠️ React vendor build had errors:', result.logs);
	}
};
