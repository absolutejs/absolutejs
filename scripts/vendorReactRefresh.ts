/* Regenerates the vendored react-refresh runtime that ships inside this
 * package's dist (dev HMR only). We vendor it so consuming projects never
 * have to install `react-refresh` themselves and pure non-React projects
 * never pull it in — the runtime is dev-only and never reaches any client
 * bundle. Run after bumping the `react-refresh` devDependency:
 *
 *   bun run scripts/vendorReactRefresh.ts
 *
 * The output is a self-contained browser ESM module with NODE_ENV baked to
 * "development" (the production runtime is a no-op stub), committed at
 * src/dev/client/vendor/reactRefreshRuntime.js. */

import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { build as bunBuild } from 'bun';

const SPECIFIER = 'react-refresh/runtime';
const OUT_FILE = join(
	import.meta.dir,
	'..',
	'src',
	'dev',
	'client',
	'vendor',
	'reactRefreshRuntime.js'
);

const runtime = await import(SPECIFIER);
const named = Object.keys(runtime).filter(
	(key) => key !== 'default' && key !== '__esModule'
);

const version =
	(await import('react-refresh/package.json', { with: { type: 'json' } }))
		.default.version ?? 'unknown';

const tmpDir = join(import.meta.dir, '..', '.vendor_react_refresh_tmp');
const entryPath = join(tmpDir, 'entry.ts');
const entrySource = [
	named.length > 0
		? `export { ${named.join(', ')} } from '${SPECIFIER}';`
		: '',
	'default' in runtime ? `export { default } from '${SPECIFIER}';` : ''
]
	.filter(Boolean)
	.join('\n');
await Bun.write(entryPath, `${entrySource}\n`);

const result = await bunBuild({
	define: { 'process.env.NODE_ENV': '"development"' },
	entrypoints: [entryPath],
	format: 'esm',
	minify: false,
	target: 'browser'
});

if (!result.success) {
	console.error(result.logs);
	throw new Error('Failed to bundle react-refresh runtime');
}

const [artifact] = result.outputs;
if (!artifact) throw new Error('No output produced for react-refresh runtime');

const header = `// @ts-nocheck
/* VENDORED: react-refresh@${version} runtime (react-refresh/runtime), bundled to
 * browser ESM with NODE_ENV="development". Dev-HMR only; never shipped to a
 * client bundle. Regenerate with: bun run scripts/vendorReactRefresh.ts */
`;

await Bun.write(OUT_FILE, header + (await artifact.text()));
await rm(tmpDir, { force: true, recursive: true });

console.log(`Vendored react-refresh@${version} -> ${OUT_FILE}`);
