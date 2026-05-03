import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { build as bunBuild } from 'bun';
import type { BunPlugin } from 'bun';

/**
 * Ember vendor build.
 *
 * Two structural reasons this looks heavier than `buildVueVendor.ts`:
 *
 *  1. Bun's resolver doesn't honor `@`-prefixed wildcard subpaths in
 *     `exports`. `ember-source/package.json` declares
 *     `"./*": "./dist/packages/*"`. Bun resolves
 *     `ember-source/ember/index.js` correctly but FAILS on
 *     `ember-source/@ember/renderer/index.js` (treats the leading `@` as
 *     a scope marker). For those specifiers we point the vendor entry at
 *     an absolute file path inside `node_modules/ember-source/dist/packages/`
 *     so the resolver never sees the `@`-prefixed subpath.
 *
 *  2. `ember-source@6.12` imports `isDevelopingApp` from
 *     `@embroider/macros` at runtime. Embroider's macros are
 *     compile-time replacements — the runtime `index.js` deliberately
 *     throws to fail loudly when the babel plugin didn't run. AbsoluteJS
 *     doesn't run babel, so we ship a tiny shim that provides working
 *     defaults (NODE_ENV-based `isDevelopingApp`, identity-style
 *     `macroCondition`, no-op `setTesting`, etc.).
 */

type EmberSpecifierResolution = {
	/** Bare specifier the user code (or compiled Ember module) imports. */
	specifier: string;
	/**
	 * What goes into the vendor entry file's `export * from '<here>'`.
	 * Either a bare specifier (resolves via node_modules) or an absolute
	 * file path (used to dodge Bun's @-prefix resolver bug).
	 */
	resolveTo: string;
	/**
	 * If set, the vendor entry uses this raw source verbatim instead of
	 * `export * from '<resolveTo>'`. Used for the @embroider/macros shim.
	 */
	inlineSource?: string;
};

const toSafeFileName = (specifier: string) =>
	specifier.replace(/^@/, '').replace(/\//g, '_');

/**
 * Build the @embroider/macros shim. ember-source 6.12 only calls
 * `isDevelopingApp` at runtime, but we cover the rest of the macro
 * surface with sane defaults so future ember-source versions don't
 * trip on the same edge.
 */
const generateMacrosShim = () => `\
// Generated shim for @embroider/macros — provides minimal runtime
// implementations for macros that would normally be replaced at
// compile time by Embroider's babel plugin. AbsoluteJS doesn't run
// babel, so working defaults are shipped instead.
const isProd = () => {
	try {
		return globalThis.process?.env?.NODE_ENV === 'production';
	} catch {
		return false;
	}
};

export const each = (arr) => {
	if (!Array.isArray(arr)) {
		throw new Error('the argument to each() must be an array');
	}
	return arr;
};
export const macroCondition = (predicate) => predicate;
export const isDevelopingApp = () => !isProd();
export const isTesting = () => false;
export const setTesting = () => {};
export const dependencySatisfies = () => false;
export const appEmberSatisfies = () => false;
export const getConfig = () => undefined;
export const getOwnConfig = () => undefined;
export const getGlobalConfig = () => ({});
export const config = () => undefined;
export const failBuild = (msg) => { throw new Error('failBuild: ' + msg); };
export const moduleExists = () => false;
export const importSync = (specifier) => {
	throw new Error('importSync(' + specifier + '): not supported by the AbsoluteJS Ember adapter — use dynamic import() instead');
};
`;

/**
 * Resolve where each specifier's real source lives. For specifiers that
 * Bun can resolve as bare (standalone npm packages, or non-@-prefixed
 * ember-source subpaths), pass through. For @-prefixed ember-source
 * subpaths, fall back to the absolute file path inside dist/packages.
 *
 * Throws if a required ember-source-internal subpath isn't on disk —
 * the caller should treat that as an installation problem.
 */
const resolveEmberSpecifier = (
	specifier: string,
	cwd: string
): EmberSpecifierResolution => {
	if (specifier === '@embroider/macros') {
		return {
			inlineSource: generateMacrosShim(),
			resolveTo: '',
			specifier
		};
	}

	// Specifiers that ARE resolvable as bare specifiers in node_modules.
	// We list them explicitly rather than try-resolving each one — keeps
	// the build deterministic and avoids surprising fallbacks.
	const standaloneSpecifiers = new Set([
		'@glimmer/component',
		'@glimmer/tracking',
		'@simple-dom/serializer'
	]);
	if (standaloneSpecifiers.has(specifier)) {
		return { resolveTo: specifier, specifier };
	}

	// ember-source-internal subpaths. These live at
	// node_modules/ember-source/dist/packages/<specifier-with-@-stripped>/index.js
	// Bun's resolver fails on `ember-source/@ember/renderer/index.js`, so we
	// dodge it with the absolute path. The plan §0.1 calls this out as a
	// 7.0 audit point — if the file layout changes, update this map.
	const emberInternalPath = join(
		cwd,
		'node_modules/ember-source/dist/packages',
		specifier,
		'index.js'
	);
	if (!existsSync(emberInternalPath)) {
		throw new Error(
			`Ember vendor build: cannot find ${specifier} at ${emberInternalPath}. ` +
				`Is ember-source installed and at least 6.12?`
		);
	}

	return { resolveTo: emberInternalPath, specifier };
};

/**
 * The set of bare specifiers the Ember adapter externalizes for client
 * bundles. Compiled Ember user code (from compileEmber.ts) and the
 * absolutejs runtime both import from these by bare name; the rewrite
 * pass swaps each to `/ember/vendor/<safe>.js` so every consumer
 * resolves to one shared module instance.
 */
const REQUIRED_EMBER_SPECIFIERS = [
	// content-tag's process() output imports from this — it's the runtime
	// template-compile entry that turns the inlined Handlebars source into
	// Glimmer opcodes when the module first evaluates.
	'@ember/template-compiler',
	// renderComponent + renderSettled — used by both the SSR pipeline and
	// the client-side mount.
	'@ember/renderer',
	// Component / @tracked — the core authoring primitives. Standalone
	// packages, not nested inside ember-source.
	'@glimmer/component',
	'@glimmer/tracking',
	// Embroider macros runtime shim (see generateMacrosShim above).
	'@embroider/macros'
];

/**
 * Server-only specifiers — used by `renderToReadableStream.ts` /
 * `pageHandler.ts` on the SSR side. Not vendored for the browser.
 */
const SERVER_ONLY_EMBER_SPECIFIERS = [
	// simple-dom's Document is the server DOM polyfill. Lives inside
	// ember-source's dist/packages/@simple-dom/document/.
	'@simple-dom/document',
	// Standalone npm package — handles tree → HTML serialization.
	'@simple-dom/serializer'
];

/**
 * Specifiers that re-export a default. `export *` only forwards named
 * exports per spec, so for these we additionally re-bind the default.
 * Other vendored modules don't carry a default; emitting `export default`
 * for them is a build error ("No matching export").
 */
const SPECIFIERS_WITH_DEFAULT_EXPORT = new Set([
	'@glimmer/component',
	'@simple-dom/serializer'
]);

const generateVendorEntrySource = (resolution: EmberSpecifierResolution) => {
	if (resolution.inlineSource !== undefined) {
		return resolution.inlineSource;
	}

	const target = JSON.stringify(resolution.resolveTo);
	const lines = [`export * from ${target};`];
	if (SPECIFIERS_WITH_DEFAULT_EXPORT.has(resolution.specifier)) {
		lines.push(`import __default__ from ${target};`);
		lines.push(`export default __default__;`);
	}

	return lines.join('\n') + '\n';
};

/**
 * EMBER_BANDAID #1 — see `EMBER_BANDAID.md`. Drop this plugin once
 * https://github.com/oven-sh/bun/issues/30187 ships in a Bun release.
 *
 * Bun.build plugin that intercepts every `@ember/*`, `@glimmer/*`,
 * `@simple-dom/*`, and `@embroider/macros` resolution. Standalone npm
 * packages (`@glimmer/component`, `@glimmer/tracking`, `@glimmer/env`,
 * `@simple-dom/serializer`) pass through to Bun's normal resolver. The
 * macros specifier maps to a generated shim file. Everything else gets
 * pointed at the corresponding file inside
 * `node_modules/ember-source/dist/packages/<spec>/index.js`, which
 * dodges Bun's @-prefix wildcard resolver bug.
 *
 * Without this plugin, building a vendor entry that transitively
 * imports e.g. `@ember/owner` (from `@glimmer/component`) fails because
 * Bun reports "Cannot find module '@ember/owner'" — the package isn't
 * standalone, it lives inside ember-source.
 */
const createEmberResolverPlugin = (
	cwd: string,
	macrosShimPath: string
): BunPlugin => ({
	name: 'absolutejs-ember-resolver',
	setup(build) {
		const standalonePackages = new Set([
			'@glimmer/component',
			'@glimmer/tracking',
			'@glimmer/env',
			'@simple-dom/serializer'
		]);

		// @embroider/macros: route to the generated shim.
		build.onResolve(
			{ filter: /^@embroider\/macros$/ },
			() => ({ path: macrosShimPath })
		);

		// @ember/*, @glimmer/*, @simple-dom/* — standalone or
		// ember-source-internal subpath.
		build.onResolve(
			{ filter: /^@(?:ember|glimmer|simple-dom)\// },
			(args) => {
				if (standalonePackages.has(args.path)) {
					// Let Bun resolve via node_modules.
					return undefined;
				}

				// Try the ember-source-internal path first.
				const internal = join(
					cwd,
					'node_modules/ember-source/dist/packages',
					args.path,
					'index.js'
				);
				if (existsSync(internal)) {
					return { path: internal };
				}

				// Fall through to Bun's resolver — handles cases where the
				// specifier is a real standalone package we forgot to enumerate.
				return undefined;
			}
		);
	}
});

/**
 * Build vendor bundles for Ember client runtime. Output goes to
 * `{buildDir}/ember/vendor/` with stable, hash-free filenames so the
 * compiled-page rewriter can produce deterministic import URLs.
 */
export const buildEmberVendor = async (
	buildDir: string,
	cwd: string = process.cwd()
) => {
	const vendorDir = join(buildDir, 'ember', 'vendor');
	mkdirSync(vendorDir, { recursive: true });

	const tmpDir = join(buildDir, '_ember_vendor_tmp');
	mkdirSync(tmpDir, { recursive: true });

	// Write the @embroider/macros shim to disk first so the resolver
	// plugin can point at it as a real file path.
	const macrosShimPath = join(tmpDir, 'embroider_macros_shim.js');
	await Bun.write(macrosShimPath, generateMacrosShim());

	const resolutions = REQUIRED_EMBER_SPECIFIERS.map((specifier) =>
		resolveEmberSpecifier(specifier, cwd)
	);

	const entrypoints = await Promise.all(
		resolutions.map(async (resolution) => {
			const safeName = toSafeFileName(resolution.specifier);
			const entryPath = join(tmpDir, `${safeName}.js`);
			// For @embroider/macros, the entry IS the shim — re-export
			// the shim's contents so the vendor file behaves the same
			// way as any other vendored module.
			const source =
				resolution.specifier === '@embroider/macros'
					? `export * from ${JSON.stringify(macrosShimPath)};\n`
					: generateVendorEntrySource(resolution);
			await Bun.write(entryPath, source);

			return entryPath;
		})
	);

	const result = await bunBuild({
		entrypoints,
		format: 'esm',
		minify: false,
		naming: '[name].[ext]',
		outdir: vendorDir,
		// Resolver plugin handles every @ember/* / @glimmer/* /
		// @simple-dom/* import — both the entry-set itself and the
		// transitive imports inside each entry. Bun.build with
		// `splitting: true` deduplicates shared chunks across vendor
		// entries automatically, so we don't need an `external` list to
		// keep bundle size sane. (Externalizing the entry-set names
		// caused vendor files to self-reference after the bare→URL
		// rewrite — `glimmer_component.js` ended up importing
		// `./glimmer_component.js` from itself.)
		plugins: [createEmberResolverPlugin(cwd, macrosShimPath)],
		splitting: true,
		target: 'browser',
		throw: false
	});

	await rm(tmpDir, { force: true, recursive: true });

	if (!result.success) {
		console.warn('⚠️ Ember vendor build had errors:', result.logs);
	}

	return REQUIRED_EMBER_SPECIFIERS;
};

/**
 * Compute the bare-specifier → URL map without running the build. The
 * dev module server uses this to rewrite user-source imports of
 * `@glimmer/component` / `@ember/template-compiler` / etc. to the stable
 * `/ember/vendor/<safe>.js` paths.
 */
export const computeEmberVendorPaths = () => {
	const paths: Record<string, string> = {};
	for (const specifier of REQUIRED_EMBER_SPECIFIERS) {
		paths[specifier] = `/ember/vendor/${toSafeFileName(specifier)}.js`;
	}

	return paths;
};

/**
 * Resolve the absolute path of a server-only Ember runtime module.
 * Server-side imports of `@simple-dom/document` / `@simple-dom/serializer`
 * dodge the vendor bundle entirely — Node's ESM resolver handles them
 * directly via the project's node_modules. The Ember pageHandler uses
 * this to dynamically import the polyfills on the SSR path.
 *
 * `@simple-dom/document` lives inside ember-source; `@simple-dom/serializer`
 * is a standalone npm package.
 */
export const resolveEmberServerModulePath = (
	specifier: string,
	cwd: string = process.cwd()
) => {
	if (!SERVER_ONLY_EMBER_SPECIFIERS.includes(specifier)) {
		throw new Error(
			`resolveEmberServerModulePath: unknown specifier "${specifier}"`
		);
	}
	if (specifier === '@simple-dom/document') {
		return join(
			cwd,
			'node_modules/ember-source/dist/packages/@simple-dom/document/index.js'
		);
	}

	// @simple-dom/serializer — let Node's resolver find it. Caller passes
	// the result to `await import(...)` which handles the actual lookup.
	return specifier;
};
