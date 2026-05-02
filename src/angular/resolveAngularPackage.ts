import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Resolve Angular package paths from the compiled runtime node_modules first,
 * then the app's process.cwd()/node_modules, falling back to the bare specifier.
 * This prevents Bun's baked import.meta.dir from resolving Angular packages
 * from the absolutejs source tree instead of the consumer's project when
 * running from a published npm package.
 */
export const resolveAngularPackageDir = (specifier: string) => {
	const fromCompiledRuntime = process.env.ABSOLUTE_BUILD_DIR
		? resolve(process.env.ABSOLUTE_BUILD_DIR, 'node_modules', specifier)
		: null;
	if (fromCompiledRuntime && existsSync(fromCompiledRuntime)) {
		return fromCompiledRuntime;
	}

	const fromProject = resolve(process.cwd(), 'node_modules', specifier);

	if (existsSync(fromProject)) {
		return fromProject;
	}

	return null;
};

const resolvePackageEntry = (packageDir: string) => {
	try {
		const pkg = JSON.parse(
			readFileSync(join(packageDir, 'package.json'), 'utf-8')
		);
		const rootExport = pkg.exports?.['.'];
		const entry =
			(typeof rootExport === 'string'
				? rootExport
				: rootExport?.default) ??
			pkg.module ??
			pkg.main ??
			'index.js';

		return join(packageDir, entry);
	} catch {
		return packageDir;
	}
};

export const resolveAngularPackage = (specifier: string) => {
	const packageDir = resolveAngularPackageDir(specifier);
	if (packageDir) return resolvePackageEntry(packageDir);

	return specifier;
};

const toSafeVendorName = (specifier: string) =>
	specifier.replace(/^@/, '').replace(/\//g, '_');

/** Prefer the linked Bun-target vendor file built by
 *  `buildAngularServerVendor`. The file is at
 *  `<ABSOLUTE_BUILD_DIR>/angular/vendor/server/<safe>.js`, which is what every
 *  server bundle's `@angular/*` imports get rewritten to point at. Sharing
 *  this path keeps SSR's class identity unified — the dual-package hazard
 *  that produces NG0201 only appears when the runtime imports a *different*
 *  copy from the bundles. Falls back to `resolveAngularPackage` (node_modules)
 *  when no vendor file is available — e.g. running tests outside an
 *  absolutejs build, or before the vendor pass completes. */
export const resolveAngularRuntimePath = (specifier: string) => {
	const buildDir = process.env.ABSOLUTE_BUILD_DIR;
	if (buildDir) {
		const vendorPath = join(
			buildDir,
			'angular',
			'vendor',
			'server',
			`${toSafeVendorName(specifier)}.js`
		);
		if (existsSync(vendorPath)) return vendorPath;
	}

	return resolveAngularPackage(specifier);
};
