import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { build as bunBuild, Glob, type BunPlugin } from 'bun';
import { generateVendorEntrySource } from './vendorEntrySource';

// `@`-scoped packages get an underscore prefix so `@foo/bar` and `foo/bar`
// produce distinct vendor filenames (both would otherwise collapse to
// `foo_bar` and overwrite each other on disk). This matters in practice for
// Firebase, which exposes a public surface (`firebase/app`) that re-exports
// from the implementation package (`@firebase/app`) — both need their own
// vendor file so the implementation file can be the single shared singleton
// and the public file can re-export through it.
const toSafeFileName = (specifier: string) => {
	const prefix = specifier.startsWith('@') ? '_' : '';

	return (
		prefix +
		specifier.replace(/\//g, '_').replace(/@/g, '').replace(/-/g, '_')
	);
};

const isResolvable = (specifier: string) => {
	try {
		Bun.resolveSync(specifier, process.cwd());

		return true;
	} catch {
		return false;
	}
};

const isBareSpecifier = (spec: string) =>
	!spec.startsWith('.') &&
	!spec.startsWith('/') &&
	!spec.startsWith('@src/');

const isAbsolutePackageSpecifier = (spec: string) =>
	spec === '@absolutejs/absolute' ||
	spec.startsWith('@absolutejs/absolute/');

// Known specifiers that are already handled by framework-specific vendors.
// React/Svelte/Vue have finite, well-known entrypoints so they're listed
// exactly. Angular publishes an open-ended ecosystem under @angular/* (router,
// forms, common/http, animations, material, cdk, …); we externalize the whole
// namespace via FRAMEWORK_NAMESPACE_PREFIXES so users can adopt new @angular/*
// packages without DI identity-mismatch bugs.
const FRAMEWORK_SPECIFIERS = new Set([
	'react',
	'react-dom',
	'react-dom/client',
	'react-dom/server',
	'react/jsx-runtime',
	'react/jsx-dev-runtime',
	'react-refresh/runtime',
	'svelte',
	'svelte/internal',
	'svelte/internal/flags/async',
	'svelte/internal/flags/legacy',
	'svelte/internal/client',
	'svelte/internal/disclose-version',
	'svelte/server',
	'svelte/store',
	'svelte/compiler',
	'vue',
	'vue/server-renderer',
	'@vue/compiler-sfc'
]);

const FRAMEWORK_NAMESPACE_PREFIXES = ['@angular/'];

const isFrameworkSpecifier = (spec: string) =>
	FRAMEWORK_SPECIFIERS.has(spec) ||
	FRAMEWORK_NAMESPACE_PREFIXES.some((prefix) => spec.startsWith(prefix));

const FRAMEWORK_EXTERNALS = [
	...FRAMEWORK_SPECIFIERS,
	...FRAMEWORK_NAMESPACE_PREFIXES.map((prefix) => `${prefix}*`)
];

const isSkippedFile = (file: string) =>
	file.includes('node_modules') ||
	file.includes('/build/') ||
	file.includes('/dist/') ||
	file.includes('/indexes/');

const isDepSpecifier = (path: string) =>
	isBareSpecifier(path) &&
	!isFrameworkSpecifier(path) &&
	!isAbsolutePackageSpecifier(path);

const isFrameworkRootCandidate = (path: string) =>
	isBareSpecifier(path) &&
	isFrameworkSpecifier(path) &&
	!isAbsolutePackageSpecifier(path);

interface ScannedSpecifiers {
	dep: string[];
	framework: string[];
}

const readFileSpecifiers = async (
	file: string,
	transpiler: Bun.Transpiler
): Promise<ScannedSpecifiers> => {
	const dep: string[] = [];
	const framework: string[] = [];
	try {
		const content = await Bun.file(file).text();
		for (const imp of transpiler.scanImports(content)) {
			if (isDepSpecifier(imp.path)) dep.push(imp.path);
			else if (isFrameworkRootCandidate(imp.path)) framework.push(imp.path);
		}
	} catch {
		// unreadable file, skip
	}

	return { dep, framework };
};

const scanDirFiles = async (dir: string) => {
	const empty: string[] = [];
	const glob = new Glob('**/*.{ts,tsx,js,jsx}');
	try {
		const all = await Array.fromAsync(
			glob.scan({ absolute: true, cwd: dir })
		);

		return all.filter((file) => !isSkippedFile(file));
	} catch {
		return empty;
	}
};

const collectDirSpecifiers = async (
	dir: string,
	transpiler: Bun.Transpiler,
	dep: Set<string>,
	framework: Set<string>
) => {
	const files = await scanDirFiles(dir);
	const results = await Promise.all(
		files.map((file) => readFileSpecifiers(file, transpiler))
	);
	for (const result of results) {
		for (const spec of result.dep) dep.add(spec);
		for (const spec of result.framework) framework.add(spec);
	}
};

// Scan source files to find all bare import specifiers
const scanBareImports = async (
	directories: string[]
): Promise<ScannedSpecifiers> => {
	const dep = new Set<string>();
	const framework = new Set<string>();
	const transpiler = new Bun.Transpiler({ loader: 'tsx' });

	await Promise.all(
		directories.map((dir) =>
			collectDirSpecifiers(dir, transpiler, dep, framework)
		)
	);

	return {
		dep: Array.from(dep).filter(isResolvable),
		framework: Array.from(framework).filter(isResolvable)
	};
};


// Resolve each bare specifier and scan its entry file for further bare imports
// (subpaths of the same or other packages). Bun's `external: ["rxjs"]` matches
// subpaths like `rxjs/operators` as a prefix, so any subpath a transitive dep
// imports needs its own vendor entry — otherwise the page bundle ends up with
// an un-resolvable `import "rxjs/operators"` and hydration 404s.
//
// Framework specs (e.g. `@angular/fire/compat/auth`) can appear as scan roots
// — their content is read and their non-framework descendants harvested — but
// the framework specs themselves are never added to the vendor list. Their own
// vendor pipeline (Angular/React/etc.) handles them. This is what surfaces
// subpaths like `@firebase/auth/internal` that an Angular package transitively
// imports through firebase-compat layers.
const collectTransitiveImports = async (
	specs: Iterable<string>,
	alreadyVendored: Set<string>,
	alreadyScanned: Set<string>
) => {
	const { readFileSync } = await import('node:fs');
	const transpiler = new Bun.Transpiler({ loader: 'js' });
	const newSpecs = new Set<string>();

	for (const spec of specs) {
		if (alreadyScanned.has(spec)) continue;
		alreadyScanned.add(spec);
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
			if (isFrameworkSpecifier(child)) continue;
			if (isAbsolutePackageSpecifier(child)) continue;
			if (alreadyVendored.has(child)) continue;
			if (!isResolvable(child)) continue;
			newSpecs.add(child);
		}
	}

	return newSpecs;
};

/** Per-entry externalization plugin.
 *
 *  Each vendor build pass receives N entries (one per discovered bare
 *  specifier) and runs them through a single `Bun.build` call. By default
 *  Bun would inline every non-`external` transitive dependency into each
 *  entry's output — meaning `firebase_auth.js` ends up with its own copy of
 *  `@firebase/component`, `firebase_firestore.js` ends up with another copy,
 *  and so on. Each inlined copy carries its own module-scoped state (the
 *  classic example: `@firebase/component`'s `_components` Map). When code
 *  registered in one bundle's copy is looked up via another bundle's copy,
 *  it appears unregistered — surfaces as `Component auth has not been
 *  registered yet` for Firebase. The same hazard applies to any package
 *  with module-scoped registries (cross-bundle event buses, plugin
 *  registries, etc.).
 *
 *  This plugin externalizes any import target that is one of the *other*
 *  known vendor specs, leaving only the entry's own spec to be inlined.
 *  After build, the post-build `rewriteVendorDirectories` step replaces the
 *  bare specifiers with `/vendor/<name>.js` URLs, so every vendor file
 *  references the same shared vendor file for any given dep. Result: every
 *  page bundle agrees on exactly one instance of every vendored dep, and
 *  module-scoped state is naturally singleton.
 *
 *  Importer disambiguation: the plugin distinguishes "this is the entry
 *  file for spec X importing X" (inline) from "any other file importing X"
 *  (externalize). The mapping from absolute entry-file path to spec is
 *  built when the entry files are written. */
// Note: a previous version of this file used a single Bun.build call for
// all vendor entries with a `dedupe` onResolve plugin that externalized
// cross-entry deps and let self-imports fall through. That hits a Bun
// bug where an onResolve plugin that matches a path and returns `null`
// (to fall through to default resolution) corrupts the bundle — Bun
// emits an exports list with no backing declarations. The fix is to
// build each entry separately with `external: [...other specs]`, so
// the self-import case never goes through any plugin.

/**
 * Strip `/* @__PURE__ * /` annotations from vendor sources before bundling.
 *
 * Why: Bun's tree-shaker drops a top-level declaration when it's annotated
 * as pure and only referenced via aliased re-exports
 * (`export { X as Y } from '...'`). The bundle ends up with `Y` listed in
 * its export clause but no `var X = ...` declaration, producing a hard
 * `SyntaxError: Export 'X' is not defined in module` at load time.
 *
 * Reproduced with `react-router`'s `Action` enum (re-exported as
 * `NavigationType`). The package's source has `var Action = / * @__PURE__ * /
 * ((Action2) => { ... })()` — Bun sees the pure annotation, considers the
 * IIFE droppable, and drops the declaration even though `Action` is the
 * only thing keeping `NavigationType` valid.
 *
 * Stripping the annotation forces Bun to retain the IIFE evaluation and
 * the resulting binding. The cost is a (very) small bundle-size increase
 * for genuinely-unused pure values, which is acceptable for a vendor
 * pipeline whose entire purpose is to ship every export of the package.
 */
const PURE_ANNOTATION = /\/\*\s*@__PURE__\s*\*\//g;

const createStripPureAnnotationsPlugin = (): BunPlugin => ({
	name: 'absolute-dep-vendor-strip-pure',
	setup(bld) {
		bld.onLoad({ filter: /\.(?:m?js|cjs)$/ }, async (args) => {
			const source = await Bun.file(args.path).text();
			if (!source.includes('@__PURE__')) return null;

			return {
				contents: source.replace(PURE_ANNOTATION, ''),
				loader: args.path.endsWith('.cjs') ? 'js' : 'js'
			};
		});
	}
});

const buildDepVendorPass = async (
	specifiers: string[],
	vendorDir: string,
	tmpDir: string
) => {
	const entries = await Promise.all(
		specifiers.map(async (specifier) => {
			const safeName = toSafeFileName(specifier);
			const entryPath = join(tmpDir, `${safeName}.ts`);
			await Bun.write(
				entryPath,
				await generateVendorEntrySource(specifier)
			);

			return { entryPath, specifier };
		})
	);

	// One Bun.build per entry. Earlier passes used a single Bun.build for
	// all entries with a dedupe plugin that externalized cross-entry deps,
	// but Bun has a bug: when an `onResolve` plugin matches a path and
	// returns `null` to fall through to default resolution, Bun emits an
	// empty re-export shell — exports list survives but every backing
	// declaration is dropped. Reproduced any time the plugin's filter
	// matches an entry file's own bare-specifier import (the self-import
	// case, where the dedupe plugin needs to NOT externalize). Returning
	// an explicit resolved path instead of null forces Bun to resolve via
	// CJS rules, dropping the package's ESM exports map (and named
	// exports). The only correct fix is to never let the plugin match
	// self-imports: build each entry separately with `external` listing
	// the OTHER specs instead of using a plugin.
	//
	// Bun's `external` matches subpaths as prefixes, so listing `rxjs`
	// externalizes `rxjs/operators` too. When building the entry for
	// `rxjs/operators` we must drop `rxjs` from the externals — otherwise
	// the own-entry's `import * from 'rxjs/operators'` gets externalized,
	// the bundle ends up empty (just an `export * from 'rxjs/operators'`
	// shell), and the rewrite step turns that into `from
	// "/vendor/rxjs_operators.js"` — which IS the file itself, producing
	// a runtime self-cycle. Same hazard with any package/subpath pair
	// (`firebase` / `firebase/auth`, `@sentry/core` /
	// `@sentry/core/scope`, etc.). Drop any spec that's a prefix of, or
	// equal to, the current spec.
	const isPrefixOrEqual = (candidate: string, current: string) =>
		current === candidate || current.startsWith(`${candidate}/`);

	const otherSpecsFor = (current: string) =>
		specifiers.filter((spec) => !isPrefixOrEqual(spec, current));

	const results = await Promise.all(
		entries.map(({ entryPath, specifier }) =>
			bunBuild({
				entrypoints: [entryPath],
				external: [...FRAMEWORK_EXTERNALS, ...otherSpecsFor(specifier)],
				format: 'esm',
				minify: false,
				naming: '[name].[ext]',
				outdir: vendorDir,
				plugins: [createStripPureAnnotationsPlugin()],
				splitting: false,
				target: 'browser',
				throw: false
			})
		)
	);

	const aggregated = {
		success: results.every((result) => result.success),
		logs: results.flatMap((result) => result.logs),
		outputs: results.flatMap((result) => result.outputs)
	};

	return aggregated;

	// Legacy single-call build kept for reference; see comment above for
	// why it can't be used. Original options:
	//
	// bunBuild({
	//   entrypoints,
	//   external: FRAMEWORK_EXTERNALS,
	//   format: 'esm',
	//   minify: false,
	//   naming: '[name].[ext]',
	//   outdir: vendorDir,
	//   plugins: [
	//     createDedupeOtherSpecsPlugin(allSpecs, entryToSpec),
	//     createStripPureAnnotationsPlugin()
	//   ],
	//   splitting: false,
	//   target: 'browser',
	//   throw: false
	// });
	//
	// (createDedupeOtherSpecsPlugin removed because per-Bun-build-call
	//  externals cleanly handle cross-entry dedupe without the plugin.)
};

const MAX_VENDOR_DISCOVERY_PASSES = 5;

export const buildDepVendor = async (
	buildDir: string,
	directories: string[]
) => {
	const { dep: initialSpecs, framework: frameworkRoots } =
		await scanBareImports(directories);
	if (initialSpecs.length === 0 && frameworkRoots.length === 0) return {};

	const vendorDir = join(buildDir, 'vendor');
	mkdirSync(vendorDir, { recursive: true });

	const tmpDir = join(buildDir, '_dep_vendor_tmp');
	mkdirSync(tmpDir, { recursive: true });

	const allSpecs = new Set<string>(initialSpecs);
	const alreadyScanned = new Set<string>();

	// Discover transitive subpath imports BEFORE the vendor build, because the
	// page bundle build (in core/build.ts) externalizes any spec that's the
	// prefix of an `external: ["pkg"]` entry — including subpaths like
	// `rxjs/operators` that aren't directly imported in user source.
	//
	// Seed pass 0 with framework roots in addition to dep specs so non-framework
	// transitive deps reachable only through a framework package
	// (e.g. `@angular/fire/compat/auth` → `firebase/compat/auth` →
	// `@firebase/auth-compat` → `@firebase/auth/internal`) are still discovered.
	let frontier: Iterable<string> = [...allSpecs, ...frameworkRoots];
	for (let pass = 0; pass < MAX_VENDOR_DISCOVERY_PASSES; pass++) {
		const additional = await collectTransitiveImports(
			frontier,
			allSpecs,
			alreadyScanned
		);
		if (additional.size === 0) break;
		for (const spec of additional) allSpecs.add(spec);
		frontier = additional;
	}

	if (allSpecs.size === 0) return {};

	const result = await buildDepVendorPass(
		Array.from(allSpecs),
		vendorDir,
		tmpDir
	);
	const success = result.success;
	if (!success) {
		console.warn('⚠️ Dependency vendor build had errors:', result.logs);
	}

	await rm(tmpDir, { force: true, recursive: true });

	// Cross-vendor specifier rewriting (e.g. a dep-vendor wrapping `@sentry/angular`
	// externalizes `@angular/core` and leaves it bare in the output) happens in a
	// centralized step after ALL vendor builds finish — see `rewriteVendorDirectories`
	// in rewriteImports.ts, called from devBuild/rebuildTrigger.

	const paths: Record<string, string> = {};
	for (const specifier of allSpecs) {
		paths[specifier] = `/vendor/${toSafeFileName(specifier)}.js`;
	}

	return paths;
};

export const computeDepVendorPaths = async (directories: string[]) => {
	const { dep: initialSpecs, framework: frameworkRoots } =
		await scanBareImports(directories);
	const allSpecs = new Set<string>(initialSpecs);
	const alreadyScanned = new Set<string>();

	// Mirror buildDepVendor's transitive discovery so the path map handed to
	// the main page build (which uses these as both externals and rewrite
	// targets) already includes subpaths like `rxjs/operators` that transitive
	// deps import — including non-framework subpaths that are only reachable
	// through a framework root. Without this, page bundles end up with
	// un-resolvable bare specifiers after externalization.
	let frontier: Iterable<string> = [...allSpecs, ...frameworkRoots];
	for (let pass = 0; pass < MAX_VENDOR_DISCOVERY_PASSES; pass++) {
		const additional = await collectTransitiveImports(
			frontier,
			allSpecs,
			alreadyScanned
		);
		if (additional.size === 0) break;
		for (const spec of additional) allSpecs.add(spec);
		frontier = additional;
	}

	const paths: Record<string, string> = {};
	for (const specifier of allSpecs) {
		paths[specifier] = `/vendor/${toSafeFileName(specifier)}.js`;
	}

	return paths;
};
