// Lean React-only build for subprocess HMR.
// Avoids importing Angular (8.8MB), Svelte (1MB), Vue compilers.
// Only does: generate React indexes → Bun.build → generate manifest.

import { build as bunBuild, Glob } from 'bun';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { generateReactIndexFiles } from './generateReactIndexes';
import { generateManifest } from './generateManifest';

const config = JSON.parse(process.argv[1]!);
const reactDir = config.reactDirectory
	? resolve(config.reactDirectory)
	: undefined;
const buildDir = resolve(config.buildDirectory || 'build');
const hmr = config.options?.injectHMR === true;
const baseManifest = config.options?.baseManifest ?? {};

if (!reactDir) {
	console.log('__MANIFEST__' + JSON.stringify(baseManifest));
	process.exit(0);
}

const pagesDir = join(reactDir, 'pages');
const indexesDir = join(reactDir, 'indexes');

// Generate React index files (hydration entry points)
mkdirSync(indexesDir, { recursive: true });
await generateReactIndexFiles(pagesDir, indexesDir, hmr);

// Scan index entries
const entries: string[] = [];
const glob = new Glob('*.tsx');
for (const f of glob.scanSync({ cwd: indexesDir, absolute: true })) {
	entries.push(f);
}
if (hmr) {
	const refresh = join(indexesDir, '_refresh.tsx');
	if (existsSync(refresh) && !entries.includes(refresh)) {
		entries.push(refresh);
	}
}

if (entries.length === 0) {
	console.log('__MANIFEST__' + JSON.stringify(baseManifest));
	process.exit(0);
}

// Compute vendor externals (React vendor paths)
let externals: string[] = [];
try {
	const { computeVendorPaths } = await import('./buildReactVendor');
	const vendorPaths = computeVendorPaths();
	if (vendorPaths) externals = Object.keys(vendorPaths);
} catch {
	// no vendor paths
}

// Clean old hashed indexes
rmSync(join(buildDir, 'react', 'indexes'), {
	force: true,
	recursive: true
});

// Build React client bundle
const result = await bunBuild({
	entrypoints: entries,
	...(externals.length > 0 ? { external: externals } : {}),
	format: 'esm',
	...(hmr ? { jsx: { development: true }, reactFastRefresh: true } : {}),
	naming: '[dir]/[name].[hash].[ext]',
	outdir: buildDir,
	root: resolve(reactDir, '..'),
	splitting: true,
	target: 'browser',
	throw: false
});

if (!result.success) {
	for (const log of result.logs) {
		console.error(log);
	}
	process.exit(1);
}

// Generate manifest
const manifest = await generateManifest(result.outputs, buildDir);

// Clean up indexes
rmSync(indexesDir, { force: true, recursive: true });

// Merge with base manifest (preserves other frameworks' entries)
const merged = { ...baseManifest, ...manifest };
console.log('__MANIFEST__' + JSON.stringify(merged));
