import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { build as bunBuild } from 'bun';

/** Bare specifiers that need stable vendor builds for Vue.
 *  Vue compiled SFC output imports from vue for the runtime. */
const vueSpecifiers = ['vue'];

/** Convert a bare specifier to a safe filename */
const toSafeFileName = (specifier: string) =>
	specifier.replace(/\//g, '_');

/** Build Vue packages into stable vendor files (no content hash).
 *  Output goes to {buildDir}/vue/vendor/ with predictable names. */
export const buildVueVendor = async (buildDir: string) => {
	const vendorDir = join(buildDir, 'vue', 'vendor');
	mkdirSync(vendorDir, { recursive: true });

	const tmpDir = join(buildDir, '_vue_vendor_tmp');
	mkdirSync(tmpDir, { recursive: true });

	// Vue is proper ESM — use export * from directly
	const entrypoints = await Promise.all(
		vueSpecifiers.map(async (specifier) => {
			const safeName = toSafeFileName(specifier);
			const entryPath = join(tmpDir, `${safeName}.ts`);
			await Bun.write(entryPath, `export * from '${specifier}';\n`);

			return entryPath;
		})
	);

	// Define Vue feature flags to prevent warnings in browser
	const result = await bunBuild({
		define: {
			__VUE_OPTIONS_API__: 'true',
			__VUE_PROD_DEVTOOLS__: 'true',
			__VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'true'
		},
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
		console.warn('⚠️ Vue vendor build had errors:', result.logs);

		return;
	}

	// Patch the vendor bundle: guard __VUE_HMR_RUNTIME__ so the vendor
	// Vue doesn't overwrite the HMR runtime set by the initial bundle.
	// Without this, importing the vendor Vue during HMR nukes all
	// component records and reload() can't find existing instances.
	const { readFileSync, writeFileSync, readdirSync } = await import(
		'node:fs'
	);
	const files = readdirSync(vendorDir).filter((f) => f.endsWith('.js'));
	for (const file of files) {
		const filePath = join(vendorDir, file);
		const content = readFileSync(filePath, 'utf-8');
		if (!content.includes('__VUE_HMR_RUNTIME__')) continue;

		const patched = content.replace(
			/getGlobalThis\(\)\.__VUE_HMR_RUNTIME__\s*=\s*\{/,
			'getGlobalThis().__VUE_HMR_RUNTIME__ = getGlobalThis().__VUE_HMR_RUNTIME__ || {'
		);
		if (patched !== content) {
			writeFileSync(filePath, patched);
		}
	}
};

/** Compute the deterministic vendor paths mapping (no build needed).
 *  This can be called before vendor files exist on disk. */
export const computeVueVendorPaths = () => {
	const paths: Record<string, string> = {};
	for (const specifier of vueSpecifiers) {
		paths[specifier] = `/vue/vendor/${toSafeFileName(specifier)}.js`;
	}

	return paths;
};
