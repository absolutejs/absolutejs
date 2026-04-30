import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { build as bunBuild, Glob } from 'bun';
import { createAngularLinkerPlugin } from './angularLinkerPlugin';
import { generateVendorEntrySource } from './vendorEntrySource';

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

const isBareSpecifier = (spec: string) =>
	!spec.startsWith('.') && !spec.startsWith('/') && !spec.startsWith('@src/');

const isAngularBrowserSpecifier = (spec: string) =>
	spec.startsWith('@angular/') && !SERVER_ONLY_ANGULAR_SPECIFIERS.has(spec);

/** Scan user source for any imports — both @angular/* (kept) and other bare
 *  specs (returned as transitive scan seeds). Finding angular subpaths only
 *  reachable through deps (e.g. `@angular/core/rxjs-interop` from
 *  `@angular/fire/compat/auth`) requires walking through non-angular roots. */
const scanSourceImports = async (directories: string[]) => {
	const angular = new Set<string>();
	const transitiveRoots = new Set<string>();
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
							angular.add(imp.path);
						} else if (isBareSpecifier(imp.path)) {
							transitiveRoots.add(imp.path);
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

	return { angular, transitiveRoots };
};

/** Walk through transitive deps and harvest any @angular/* subpaths reachable
 *  via non-angular packages (e.g. firebase imports `@angular/core/rxjs-interop`
 *  through @angular/fire). Mirrors buildDepVendor's framework-root traversal. */
const collectTransitiveAngularSpecs = async (
	roots: Iterable<string>,
	angularFound: Set<string>
) => {
	const { readFileSync } = await import('node:fs');
	const transpiler = new Bun.Transpiler({ loader: 'js' });
	const visited = new Set<string>();
	const frontier: string[] = [];
	for (const r of roots) frontier.push(r);

	const MAX_PASSES = 5;
	for (let pass = 0; pass < MAX_PASSES; pass++) {
		const next: string[] = [];
		for (const spec of frontier) {
			if (visited.has(spec)) continue;
			visited.add(spec);
			let resolved: string;
			try {
				resolved = Bun.resolveSync(spec, process.cwd());
			} catch {
				continue;
			}
			let content: string;
			try {
				content = readFileSync(resolved, 'utf-8');
			} catch {
				continue;
			}
			let imports;
			try {
				imports = transpiler.scanImports(content);
			} catch {
				continue;
			}
			for (const imp of imports) {
				const child = imp.path;
				if (!isBareSpecifier(child)) continue;
				if (visited.has(child)) continue;
				if (isAngularBrowserSpecifier(child)) {
					angularFound.add(child);
				}
				next.push(child);
			}
		}
		if (next.length === 0) break;
		frontier.length = 0;
		for (const s of next) frontier.push(s);
	}
};

/** Convert a bare specifier to a safe filename:
 *  @angular/common/http → angular_common_http */
const toSafeFileName = (specifier: string) =>
	specifier.replace(/^@/, '').replace(/\//g, '_');

const resolveAngularSpecifiers = async (directories: string[]) => {
	const { angular, transitiveRoots } = await scanSourceImports(directories);
	for (const spec of REQUIRED_ANGULAR_SPECIFIERS) angular.add(spec);
	await collectTransitiveAngularSpecs(
		[...angular, ...transitiveRoots],
		angular
	);

	return Array.from(angular).filter(isResolvable);
};

/** Build vendor bundles for every @angular/* package the project imports.
 *  `linkerJitMode` controls whether NgModule definitions retain their
 *  declarations/exports — required when consumer (user) components are
 *  runtime-compiled by `@angular/compiler` (dev/HMR via compileAngularFileJIT).
 *  Production AOT builds set this to false to match AOT'd user components.
 *
 *  `depVendorSpecifiers` are non-framework packages that are also vendored
 *  separately (by `buildDepVendor`). They MUST be externalized here too —
 *  otherwise transitive imports like `@angular/fire/compat/auth` →
 *  `firebase/compat/auth` get bundled twice, creating duplicate
 *  @firebase/app-compat instances. The angular-vendor copy registers
 *  `firebase.auth.*` on its own firebase singleton, leaving the user's
 *  `import firebase from 'firebase/compat/app'` with `firebase.auth` undefined.
 *  Externalizing forces both pipelines to share the same /vendor chunks. */
export const buildAngularVendor = async (
	buildDir: string,
	directories: string[] = [],
	linkerJitMode = false,
	depVendorSpecifiers: string[] = []
) => {
	const vendorDir = join(buildDir, 'angular', 'vendor');
	mkdirSync(vendorDir, { recursive: true });

	const tmpDir = join(buildDir, '_angular_vendor_tmp');
	mkdirSync(tmpDir, { recursive: true });

	const specifiers = await resolveAngularSpecifiers(directories);

	// Angular packages are proper ESM. `export *` re-exports only NAMED exports
	// per ECMA spec, so we use the namespace-default-fallback pattern that's
	// safe regardless of whether the package has a default export.
	const entrypoints = await Promise.all(
		specifiers.map(async (specifier) => {
			const safeName = toSafeFileName(specifier);
			const entryPath = join(tmpDir, `${safeName}.ts`);
			await Bun.write(entryPath, generateVendorEntrySource(specifier));

			return entryPath;
		})
	);

	const result = await bunBuild({
		entrypoints,
		external: depVendorSpecifiers,
		format: 'esm',
		minify: false,
		naming: '[name].[ext]',
		outdir: vendorDir,
		plugins: [createAngularLinkerPlugin(linkerJitMode)],
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

/** Async variant that scans source + transitive deps before producing the
 *  vendor path map. Use this when the page-bundle build needs the full set of
 *  angular specs in its rewrite map (otherwise transitively-discovered subpaths
 *  like `@angular/core/rxjs-interop` end up as bare specifiers in the output). */
export const computeAngularVendorPathsAsync = async (
	directories: string[] = []
) => {
	const specifiers = await resolveAngularSpecifiers(directories);

	return computeAngularVendorPaths(specifiers);
};
