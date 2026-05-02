import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { build as bunBuild, Glob } from 'bun';
import { createAngularLinkerPlugin } from './angularLinkerPlugin';
import { generateVendorEntrySource } from './vendorEntrySource';

/** Always-vendored Angular packages.
 *  Required for any Angular page even if not imported in user code: the runtime
 *  needs them to bootstrap. Server-only packages (@angular/platform-server) are
 *  excluded. Additional @angular/* packages are auto-discovered from source.
 *
 *  `@angular/compiler` is included only when the vendor is built in JIT mode
 *  (dev). In AOT mode (prod) every `ɵɵngDeclare*` has been linked at vendor
 *  build time, so the compiler isn't needed at runtime and is dropped to keep
 *  the prod artifact slim. */
const REQUIRED_ANGULAR_SPECIFIERS_BASE = [
	'@angular/core',
	'@angular/common',
	'@angular/common/http',
	'@angular/platform-browser',
	// `@angular/router` is used by `routerRedirectProviders.ts` in the
	// absolutejs runtime, not directly by user code, so source scanning
	// won't discover it. Force-include it so SSR's runtime resolution
	// finds the linked vendor copy instead of falling back to node_modules.
	'@angular/router'
];
const requiredAngularSpecifiers = (jitMode: boolean) =>
	jitMode
		? [...REQUIRED_ANGULAR_SPECIFIERS_BASE, '@angular/compiler']
		: REQUIRED_ANGULAR_SPECIFIERS_BASE;

/** Server-only Angular packages — needed for SSR runtime, not for the
 *  browser. `@angular/compiler-cli` is intentionally omitted: it's a
 *  build-time package (it ships the linker and the AOT compiler) and has
 *  no runtime role, so vendoring it would just bloat the artifact. */
const SERVER_ONLY_ANGULAR_SPECIFIERS = new Set([
	'@angular/platform-server',
	'@angular/ssr'
]);

const BUILD_ONLY_ANGULAR_SPECIFIER_PREFIXES = [
	'@angular/compiler-cli',
	'@angular/localize/tools'
];

const isBuildOnlyAngularSpecifier = (spec: string) =>
	BUILD_ONLY_ANGULAR_SPECIFIER_PREFIXES.some(
		(prefix) => spec === prefix || spec.startsWith(`${prefix}/`)
	);

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
	spec.startsWith('@angular/') &&
	!SERVER_ONLY_ANGULAR_SPECIFIERS.has(spec) &&
	!isBuildOnlyAngularSpecifier(spec);

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

/** Marker substrings emitted by Angular's partial-AOT compiler into any
 *  package that ships `ɵɵngDeclare*` declarations. The presence of any
 *  one of these means the file needs the linker before it can run, which
 *  in turn means the package belongs in the Angular vendor — even if it's
 *  not under `@angular/*` (e.g. `@ngx-translate/core`, `@ng-bootstrap`,
 *  community Material extensions, etc.). Mirrors `declarationFunctions`
 *  in `@angular/compiler-cli/linker`. */
const PARTIAL_DECL_MARKERS = [
	'ɵɵngDeclareDirective',
	'ɵɵngDeclareComponent',
	'ɵɵngDeclareFactory',
	'ɵɵngDeclareInjectable',
	'ɵɵngDeclareInjector',
	'ɵɵngDeclareNgModule',
	'ɵɵngDeclarePipe',
	'ɵɵngDeclareClassMetadata'
];

const containsPartialDeclarations = (source: string) =>
	PARTIAL_DECL_MARKERS.some((marker) => source.includes(marker));

/** Walk through transitive deps and harvest any @angular/* subpaths reachable
 *  via non-angular packages (e.g. firebase imports `@angular/core/rxjs-interop`
 *  through @angular/fire). Also harvests any non-@angular package whose
 *  shipped code contains partial AOT declarations — those need the linker
 *  too, so they belong in the Angular vendor pipeline. */
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
			// If this file ships partial AOT declarations, the *package* it
			// belongs to needs the linker — add the spec used to import it.
			// Skip if it's already an @angular/* spec (covered separately).
			if (
				!isAngularBrowserSpecifier(spec) &&
				containsPartialDeclarations(content)
			) {
				angularFound.add(spec);
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

const resolveAngularSpecifiers = async (
	directories: string[],
	linkerJitMode: boolean
) => {
	const { angular, transitiveRoots } = await scanSourceImports(directories);
	for (const spec of requiredAngularSpecifiers(linkerJitMode)) {
		angular.add(spec);
	}
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

	const specifiers = await resolveAngularSpecifiers(
		directories,
		linkerJitMode
	);

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
	specifiers: string[] = requiredAngularSpecifiers(true)
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
	directories: string[] = [],
	linkerJitMode = true
) => {
	const specifiers = await resolveAngularSpecifiers(
		directories,
		linkerJitMode
	);

	return computeAngularVendorPaths(specifiers);
};

/** Server-side counterpart to `buildAngularVendor`. Outputs fully-linked
 *  Bun-target ESM bundles for every @angular/* package the project uses,
 *  *plus* `@angular/platform-server` and `@angular/ssr` (excluded from the
 *  browser vendor). The server bundle and `getAngularDeps()` import from
 *  these paths so SSR shares one Angular runtime instance with the page
 *  bundles — eliminates the dual-package hazard that produces NG0201.
 *
 *  After this build, `@angular/compiler` is no longer required at runtime
 *  for AOT-mode builds: every partial `ɵɵngDeclare*` has been linked into
 *  final ɵdir/ɵcmp/ɵfac definitions in the vendor output. */
export const buildAngularServerVendor = async (
	buildDir: string,
	directories: string[] = [],
	linkerJitMode = false
) => {
	const vendorDir = join(buildDir, 'angular', 'vendor', 'server');
	mkdirSync(vendorDir, { recursive: true });

	const tmpDir = join(buildDir, '_angular_server_vendor_tmp');
	mkdirSync(tmpDir, { recursive: true });

	const browserSpecs = await resolveAngularSpecifiers(
		directories,
		linkerJitMode
	);
	const allSpecs = new Set(browserSpecs);
	for (const spec of SERVER_ONLY_ANGULAR_SPECIFIERS) {
		if (isResolvable(spec)) allSpecs.add(spec);
	}
	const specifiers = Array.from(allSpecs);

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
		format: 'esm',
		minify: false,
		naming: '[name].[ext]',
		outdir: vendorDir,
		plugins: [createAngularLinkerPlugin(linkerJitMode)],
		splitting: true,
		target: 'bun',
		throw: false
	});

	await rm(tmpDir, { force: true, recursive: true });

	if (!result.success) {
		console.warn(
			'⚠️ Angular server vendor build had errors:',
			result.logs
		);
	}

	return specifiers;
};

/** Absolute filesystem paths to server vendor files, for `rewriteImports`
 *  on server-side bundles and for runtime resolution in `getAngularDeps`. */
export const computeAngularServerVendorPaths = (
	buildDir: string,
	specifiers: string[]
) => {
	const paths: Record<string, string> = {};
	const vendorDir = join(buildDir, 'angular', 'vendor', 'server');
	for (const specifier of specifiers) {
		paths[specifier] = join(vendorDir, `${toSafeFileName(specifier)}.js`);
	}

	return paths;
};

/** Async server-vendor path map: scans source + transitive deps, then
 *  produces absolute filesystem paths for every @angular/* spec the project
 *  uses (plus the always-vendored server-only specs). Mirrors
 *  `computeAngularVendorPathsAsync` but for server-side rewriting. */
export const computeAngularServerVendorPathsAsync = async (
	buildDir: string,
	directories: string[] = [],
	linkerJitMode = true
) => {
	const browserSpecs = await resolveAngularSpecifiers(
		directories,
		linkerJitMode
	);
	const allSpecs = new Set(browserSpecs);
	for (const spec of SERVER_ONLY_ANGULAR_SPECIFIERS) {
		if (isResolvable(spec)) allSpecs.add(spec);
	}

	return computeAngularServerVendorPaths(buildDir, Array.from(allSpecs));
};
