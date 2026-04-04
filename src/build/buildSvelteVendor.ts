import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { build as bunBuild } from 'bun';

/** Bare specifiers that need stable vendor builds for Svelte.
 *  Svelte 5 compiled output imports from svelte/internal/client
 *  for the client-side runtime. */
const svelteSpecifiers = [
	'svelte',
	'svelte/internal',
	'svelte/internal/flags/async',
	'svelte/internal/client',
	'svelte/internal/disclose-version',
	'svelte/store'
];

const isResolvable = (specifier: string) => {
	try {
		require.resolve(specifier);

		return true;
	} catch {
		return false;
	}
};

/** Resolve which Svelte specifiers are actually installed */
const resolveVendorSpecifiers = () =>
	svelteSpecifiers.filter(isResolvable);

/** Convert a bare specifier to a safe filename: svelte/internal/client → svelte_internal_client */
const toSafeFileName = (specifier: string) =>
	specifier.replace(/\//g, '_');

/** Build Svelte packages into stable vendor files (no content hash).
 *  Output goes to {buildDir}/svelte/vendor/ with predictable names. */
export const buildSvelteVendor = async (buildDir: string) => {
	const specifiers = resolveVendorSpecifiers();
	if (specifiers.length === 0) return;

	const vendorDir = join(buildDir, 'svelte', 'vendor');
	mkdirSync(vendorDir, { recursive: true });

	const tmpDir = join(buildDir, '_svelte_vendor_tmp');
	mkdirSync(tmpDir, { recursive: true });

	const entrypoints = await Promise.all(
		specifiers.map(async (specifier) => {
			const safeName = toSafeFileName(specifier);
			const entryPath = join(tmpDir, `${safeName}.ts`);
			await Bun.write(entryPath, `export * from '${specifier}';\n`);

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
		console.warn('⚠️ Svelte vendor build had errors:', result.logs);
	}
};

/** Compute the deterministic vendor paths mapping (no build needed).
 *  This can be called before vendor files exist on disk. */
export const computeSvelteVendorPaths = () => {
	const paths: Record<string, string> = {};
	for (const specifier of resolveVendorSpecifiers()) {
		paths[specifier] = `/svelte/vendor/${toSafeFileName(specifier)}.js`;
	}

	return paths;
};
