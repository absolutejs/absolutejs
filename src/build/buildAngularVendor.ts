import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { build as bunBuild } from 'bun';

/** Bare specifiers that need stable vendor builds for Angular.
 *  These are the packages imported by Angular client-side code
 *  (component files + hydration index). Server-only packages
 *  like @angular/platform-server are excluded. */
const angularSpecifiers = [
	'@angular/core',
	'@angular/compiler',
	'@angular/common',
	'@angular/common/http',
	'@angular/platform-browser'
];

/** Convert a bare specifier to a safe filename:
 *  @angular/common/http → angular_common_http */
const toSafeFileName = (specifier: string): string =>
	specifier.replace(/^@/, '').replace(/\//g, '_');

/** Compute the deterministic vendor paths mapping (no build needed).
 *  This can be called before vendor files exist on disk. */
export const buildAngularVendor = async (buildDir: string): Promise<void> => {
	const vendorDir = join(buildDir, 'angular', 'vendor');
	mkdirSync(vendorDir, { recursive: true });

	const tmpDir = join(buildDir, '_angular_vendor_tmp');
	mkdirSync(tmpDir, { recursive: true });

	// Angular packages are proper ESM — use `export * from` directly.
	// (Unlike React which is CJS and needs runtime introspection.)
	const entrypoints: string[] = [];
	for (const specifier of angularSpecifiers) {
		const safeName = toSafeFileName(specifier);
		const entryPath = join(tmpDir, `${safeName}.ts`);
		await Bun.write(entryPath, `export * from '${specifier}';\n`);
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
		console.warn('⚠️ Angular vendor build had errors:', result.logs);
	}
};
export const computeAngularVendorPaths = (): Record<string, string> => {
	const paths: Record<string, string> = {};
	for (const specifier of angularSpecifiers) {
		paths[specifier] = `/angular/vendor/${toSafeFileName(specifier)}.js`;
	}

	return paths;
};
