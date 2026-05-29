import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import { build as bunBuild } from 'bun';
import { reactRefreshRuntimePath } from './generateReactIndexes';

const resolveJsxDevRuntimeCompatPath = () => {
	const candidates = [
		resolve(import.meta.dir, 'react', 'jsxDevRuntimeCompat.js'),
		resolve(import.meta.dir, 'src', 'react', 'jsxDevRuntimeCompat.ts'),
		resolve(import.meta.dir, '..', 'react', 'jsxDevRuntimeCompat.js'),
		resolve(
			import.meta.dir,
			'..',
			'src',
			'react',
			'jsxDevRuntimeCompat.ts'
		),
		resolve(
			import.meta.dir,
			'..',
			'..',
			'dist',
			'react',
			'jsxDevRuntimeCompat.js'
		),
		resolve(
			import.meta.dir,
			'..',
			'..',
			'src',
			'react',
			'jsxDevRuntimeCompat.ts'
		)
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate.replace(/\\/g, '/');
		}
	}

	return (
		candidates[0] ??
		resolve(import.meta.dir, 'react', 'jsxDevRuntimeCompat.js')
	).replace(/\\/g, '/');
};

const jsxDevRuntimeCompatPath = resolveJsxDevRuntimeCompatPath();

/** Bare specifiers that need stable vendor builds */
const reactSpecifiers = [
	'react',
	'react-dom',
	'react-dom/client',
	'react/jsx-runtime',
	'react/jsx-dev-runtime',
	// react-refresh/runtime is built from the copy vendored inside this
	// package (see generateEntrySource), not node_modules — consumers never
	// install react-refresh. Externalizing it (rather than resolve-and-bundle
	// with code splitting) keeps Bun's reactFastRefresh `register` binding a
	// stable named import from this vendor file instead of a cross-chunk
	// hoisted `export_register`, which Bun fails to re-link on incremental
	// HMR rebuilds (issue #38). reactRefreshSetup imports the same specifier,
	// so both resolve to one shared runtime instance.
	'react-refresh/runtime'
];

/** Convert a bare specifier to a safe filename: react-dom/client → react-dom_client */
const toSafeFileName = (specifier: string) => specifier.replace(/\//g, '_');

/** Compute the deterministic vendor paths mapping (no build needed).
 *  This can be called before vendor files exist on disk. */
export const computeVendorPaths = () => {
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
const generateEntrySource = async (specifier: string) => {
	if (specifier === 'react/jsx-dev-runtime') {
		return `export { Fragment, jsxDEV } from '${jsxDevRuntimeCompatPath}';\n`;
	}

	// Source the refresh runtime from the package's vendored copy rather than
	// `await import('react-refresh/runtime')`, which would fail in consumer
	// projects that don't have react-refresh installed.
	if (specifier === 'react-refresh/runtime') {
		return `export * from '${reactRefreshRuntimePath}';\n`;
	}

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

	return `${lines.join('\n')}\n`;
};

/** Build React packages into stable vendor files (no content hash).
 *  Output goes to {buildDir}/react/vendor/ with predictable names like
 *  react.js, react-dom_client.js, etc. These files never change between
 *  rebuilds, so the browser always loads React from a single source. */
export const buildReactVendor = async (buildDir: string) => {
	const vendorDir = join(buildDir, 'react', 'vendor');
	mkdirSync(vendorDir, { recursive: true });

	const tmpDir = join(buildDir, '_vendor_tmp');
	mkdirSync(tmpDir, { recursive: true });

	const specifiers = reactSpecifiers;

	// Create temp entry files with explicit named exports
	const entrypoints = await Promise.all(
		specifiers.map(async (specifier) => {
			const safeName = toSafeFileName(specifier);
			const entryPath = join(tmpDir, `${safeName}.ts`);
			const source = await generateEntrySource(specifier);
			await Bun.write(entryPath, source);

			return entryPath;
		})
	);

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
