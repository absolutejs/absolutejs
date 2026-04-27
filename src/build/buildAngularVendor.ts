import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { build as bunBuild, Glob } from 'bun';
import { angularLinkerPlugin } from './angularLinkerPlugin';

/** Always-vendored Angular packages.
 *  Required for any Angular page even if not imported in user code: the runtime
 *  needs them to bootstrap. Server-only packages (@angular/platform-server) are
 *  excluded. Additional @angular/* packages are auto-discovered from source. */
const REQUIRED_ANGULAR_SPECIFIERS = [
	'@angular/core',
	'@angular/compiler',
	'@angular/common',
	'@angular/common/http',
	'@angular/platform-browser'
];

/** Build-only / server-only specifiers that should never be browser-vendored. */
const SERVER_ONLY_ANGULAR_SPECIFIERS = new Set([
	'@angular/platform-server',
	'@angular/ssr',
	'@angular/compiler-cli'
]);

const SCAN_SKIP_DIRS = new Set([
	'node_modules',
	'build',
	'dist',
	'.absolutejs',
	'generated'
]);

const isResolvable = (specifier: string) => {
	try {
		Bun.resolveSync(specifier, process.cwd());

		return true;
	} catch {
		return false;
	}
};

const isAngularBrowserSpecifier = (spec: string) =>
	spec.startsWith('@angular/') && !SERVER_ONLY_ANGULAR_SPECIFIERS.has(spec);

/** Scan user source for any @angular/* imports so adding e.g. @angular/router,
 *  @angular/animations, @angular/material works without changes here. */
const scanAngularSpecifiers = async (directories: string[]) => {
	const found = new Set<string>();
	const transpiler = new Bun.Transpiler({ loader: 'tsx' });
	const glob = new Glob('**/*.{ts,tsx,js,jsx}');

	for (const dir of directories) {
		try {
			for await (const file of glob.scan({ absolute: true, cwd: dir })) {
				const rel = file.slice(dir.length + 1);
				const [first] = rel.split('/');
				if (first && SCAN_SKIP_DIRS.has(first)) continue;
				try {
					const content = await Bun.file(file).text();
					for (const imp of transpiler.scanImports(content)) {
						if (isAngularBrowserSpecifier(imp.path)) {
							found.add(imp.path);
						}
					}
				} catch {
					// unreadable file, skip
				}
			}
		} catch {
			// missing dir, skip
		}
	}

	return found;
};

/** Convert a bare specifier to a safe filename:
 *  @angular/common/http → angular_common_http */
const toSafeFileName = (specifier: string) =>
	specifier.replace(/^@/, '').replace(/\//g, '_');

const resolveAngularSpecifiers = async (directories: string[]) => {
	const discovered = await scanAngularSpecifiers(directories);
	for (const spec of REQUIRED_ANGULAR_SPECIFIERS) discovered.add(spec);

	return Array.from(discovered).filter(isResolvable);
};

/** Build vendor bundles for every @angular/* package the project imports. */
export const buildAngularVendor = async (
	buildDir: string,
	directories: string[] = []
) => {
	const vendorDir = join(buildDir, 'angular', 'vendor');
	mkdirSync(vendorDir, { recursive: true });

	const tmpDir = join(buildDir, '_angular_vendor_tmp');
	mkdirSync(tmpDir, { recursive: true });

	const specifiers = await resolveAngularSpecifiers(directories);

	// Angular packages are proper ESM — use `export * from` directly.
	// (Unlike React which is CJS and needs runtime introspection.)
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
		plugins: [angularLinkerPlugin],
		splitting: true,
		target: 'browser',
		throw: false
	});

	await rm(tmpDir, { force: true, recursive: true });

	if (!result.success) {
		console.warn('⚠️ Angular vendor build had errors:', result.logs);
	}

	return specifiers;
};
export const computeAngularVendorPaths = (
	specifiers: string[] = REQUIRED_ANGULAR_SPECIFIERS
) => {
	const paths: Record<string, string> = {};
	for (const specifier of specifiers) {
		paths[specifier] = `/angular/vendor/${toSafeFileName(specifier)}.js`;
	}

	return paths;
};
