import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { build as bunBuild, Transpiler, write, file } from 'bun';
import type { BunPlugin } from 'bun';
import { getFrameworkGeneratedDir } from '../utils/generatedDir';

/**
 * Phase 1 Ember compile pipeline.
 *
 * For each `.gjs` / `.gts` / `.ts` page entry:
 *
 *  1. Read the source.
 *  2. If it's a template-tag file (`.gjs` / `.gts`), run `content-tag`'s
 *     `Preprocessor.process()` to extract every `<template>` block,
 *     replacing each with a `static { template_HASH(...) }` call and
 *     prepending the matching `import { template as template_HASH }
 *     from "@ember/template-compiler"`.
 *  3. Hand the resulting source to `Bun.Transpiler` to strip TypeScript
 *     and lower decorators (`@tracked` etc.).
 *  4. Write twin outputs — one in `compiled/server/` (used by the SSR
 *     adapter via `await import(...)`) and one in `compiled/client/`
 *     (used as the entrypoint for the per-page client bundle pass).
 *     Both files are textually identical for v1; framework-specific
 *     environment shims live in the page handler / browser entry, not
 *     in the compiled module.
 *
 * No HMR caching, no island lowering, no template-AST scan. Phase 2 /
 * Phase 3 features layer on top of this base.
 */

type CompileEmberResult = {
	/** Absolute path to the SSR-side compiled module. */
	serverPath: string;
	/** Absolute path to the client-side compiled module. */
	clientPath: string;
};

type ContentTagModule = {
	Preprocessor: new () => {
		process: (
			source: string,
			options: { filename?: string }
		) => { code: string; map: string };
	};
};

let cachedPreprocessor:
	| {
			process: (
				source: string,
				options: { filename?: string }
			) => { code: string; map: string };
	  }
	| null = null;

const getPreprocessor = async () => {
	if (cachedPreprocessor) return cachedPreprocessor;
	const module: ContentTagModule = await import('content-tag');
	cachedPreprocessor = new module.Preprocessor();

	return cachedPreprocessor;
};

/**
 * Tracked-by: docs/EMBER_PLAN.md §0.1 "Stage-3 decorator migration".
 *
 * Glimmer's `@tracked` decorator (and Ember's `@service`, `@action`, etc.)
 * are written for the legacy stage-1 / TypeScript decorator semantics —
 * different argument shape than the TC39 stage-3 spec Bun.Transpiler
 * defaults to. Without `experimentalDecorators`, `@tracked` throws
 * "Properties can only be defined on Objects" at module evaluation
 * because Bun emits the new-style decorator runtime against an
 * old-style decorator implementation.
 *
 * `useDefineForClassFields: false` matches what classic Ember projects
 * have shipped with for years — the `@tracked` runtime walks the
 * class prototype chain in a way that the modern "true" semantics
 * break.
 *
 * Drop both flags once Glimmer migrates `@tracked` (and friends) to
 * stage-3. docs/EMBER_PLAN.md §0.1 documents what to watch for and the
 * contingency if upstream never ships the migration.
 */
const transpiler = new Transpiler({
	loader: 'ts',
	target: 'browser',
	tsconfig: JSON.stringify({
		compilerOptions: {
			experimentalDecorators: true,
			useDefineForClassFields: false
		}
	})
});

const isTemplateTagFile = (entry: string) => {
	const ext = extname(entry);

	return ext === '.gjs' || ext === '.gts';
};

/**
 * Replace content-tag's `eval(arguments[0])` scope shim with an explicit
 * `scope()` function exposing the page module's top-level imports.
 *
 * Why: content-tag emits `eval()` so the template compiler can resolve
 * lexical identifiers via the host module's JS scope. That works great
 * for unbundled ES modules, but Bun.build flattens every imported file
 * into one shared scope — meaning the bundled `function main` (renderer
 * stdlib), `function tracked2` (Glimmer), and many other helpers leak
 * into the eval scope. The template compiler then sees `typeof main !==
 * "undefined"` succeed and decides `<main>` is a lexical-scoped
 * component instead of an HTML element, causing
 * "Attempted to load a component, but there wasn't a component manager
 * associated with the definition. The definition was: main".
 *
 * Switching to an explicit `scope()` constrains the lexical-scope check
 * to identifiers the user actually imported — HTML tag names like
 * `<main>` correctly fall through to the HTML branch.
 */
const rewriteTemplateEvalToScope = (source: string) => {
	const importedNames = new Set<string>();

	const importRegex =
		/^\s*import\s+(?:type\s+)?(?:(\*\s+as\s+\w+)|(\w+)(?:\s*,\s*\{([^}]+)\})?|\{([^}]+)\})\s+from\s+['"][^'"]+['"]/gm;
	let match;
	while ((match = importRegex.exec(source)) !== null) {
		const [, namespaceImport, defaultImport, namedAfterDefault, named] =
			match;

		if (namespaceImport) {
			const aliasMatch = /\*\s+as\s+(\w+)/.exec(namespaceImport);
			if (aliasMatch?.[1]) importedNames.add(aliasMatch[1]);
		}
		if (defaultImport) importedNames.add(defaultImport);
		const namedList = named ?? namedAfterDefault;
		if (namedList) {
			for (const part of namedList.split(',')) {
				const trimmed = part.trim();
				if (!trimmed) continue;
				// Handle `foo as bar` — bar is the local binding
				const asMatch = /\bas\s+(\w+)$/.exec(trimmed);
				const localName = asMatch
					? asMatch[1]
					: trimmed.replace(/^type\s+/, '');
				if (localName && /^\w+$/.test(localName)) {
					importedNames.add(localName);
				}
			}
		}
	}

	const scopeObject =
		importedNames.size === 0
			? '{}'
			: `{ ${Array.from(importedNames).join(', ')} }`;

	// content-tag emits the eval shim with a stable shape — replace each
	// occurrence with an equivalent `scope()` returning the explicit map.
	const evalShim = /eval\s*\(\)\s*\{\s*return\s+eval\(arguments\[0\]\);\s*\}/g;

	return source.replace(evalShim, `scope() { return ${scopeObject}; }`);
};

/**
 * Inline source for the `@embroider/macros` shim. ember-source 6.12
 * imports `isDevelopingApp` (and may add more macros in future patch
 * releases); the package's root `index.js` deliberately throws because
 * Embroider's babel plugin is supposed to replace these calls at
 * compile time. AbsoluteJS doesn't run babel, so this shim provides
 * working defaults instead.
 *
 * Kept inline (not a file on disk) so a single Bun.build virtual-module
 * plugin can serve it for both compileEmber and buildEmberVendor — one
 * source of truth, no shared file-system contract between the two.
 */
const EMBROIDER_MACROS_SHIM_SOURCE = `\
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
 * EMBER_BANDAID #1 — see `docs/EMBER_BANDAID.md`. Drop the @ember/* /
 * @glimmer/* / @simple-dom/* `onResolve` rules once
 * https://github.com/oven-sh/bun/issues/30187 ships. The
 * @embroider/macros virtualization stays regardless (separate concern).
 *
 * Bun.build plugin that intercepts every `@ember/*`, `@glimmer/*`,
 * `@simple-dom/*`, and `@embroider/macros` resolution. Same shape as
 * the one in `buildEmberVendor.ts` — copy-paste rather than share so
 * the two pipelines can evolve independently if/when one needs a
 * different resolver policy.
 */
type EmberResolverOptions = {
	/** Map from staged tmp file path -> original source file path. Lets the
	 *  resolver translate relative imports made by the staged module back to
	 *  the original directory tree, which is what the source actually meant. */
	stagedSourceMap?: Map<string, string>;
};

const createEmberServerResolverPlugin = (
	cwd: string,
	options: EmberResolverOptions = {}
): BunPlugin => ({
	name: 'absolutejs-ember-server-resolver',
	setup(build) {
		const standalonePackages = new Set([
			'@glimmer/component',
			'@glimmer/tracking',
			'@glimmer/env',
			'@simple-dom/serializer'
		]);

		// @embroider/macros: serve the inline shim via a virtual module.
		// Returning a custom namespace + path makes Bun route the
		// follow-up onLoad call here, where we hand back the shim source.
		build.onResolve(
			{ filter: /^@embroider\/macros$/ },
			() => ({
				namespace: 'absolutejs-ember-virtual',
				path: 'embroider-macros-shim'
			})
		);

		build.onLoad(
			{
				filter: /^embroider-macros-shim$/,
				namespace: 'absolutejs-ember-virtual'
			},
			() => ({
				contents: EMBROIDER_MACROS_SHIM_SOURCE,
				loader: 'js'
			})
		);

		// Translate relative imports from staged tmp modules back to the
		// original source directory before letting Bun resolve them. The
		// staged module sits in `<emberDir>/generated/_tmp/` so a `../foo`
		// import would otherwise miss the real source file entirely.
		const stagedSourceMap = options.stagedSourceMap;
		if (stagedSourceMap && stagedSourceMap.size > 0) {
			build.onResolve({ filter: /^\.{1,2}\// }, (args) => {
				const originalImporter = stagedSourceMap.get(args.importer);
				if (!originalImporter) return undefined;

				const candidateBase = resolve(
					dirname(originalImporter),
					args.path
				);

				const extensionsToTry = ['', '.gts', '.gjs', '.ts', '.js'];
				for (const ext of extensionsToTry) {
					const candidate = candidateBase + ext;
					if (existsSync(candidate)) return { path: candidate };
				}

				return undefined;
			});
		}

		// `.gts`/`.gjs` Glimmer template-tag modules need the same
		// content-tag preprocessing the page module gets. Without this,
		// any imported component file with a `<template>` block fails to
		// parse during the server bundle pass. Run the same eval->scope
		// rewrite so bundled identifiers don't leak into template scope.
		build.onLoad({ filter: /\.(gts|gjs)$/ }, async (args) => {
			const source = await file(args.path).text();
			const preprocessor = await getPreprocessor();
			const result = preprocessor.process(source, {
				filename: args.path
			});
			const rewritten = rewriteTemplateEvalToScope(result.code);
			const transpiled = transpiler.transformSync(rewritten);

			return { contents: transpiled, loader: 'js' };
		});

		build.onResolve(
			{ filter: /^@(?:ember|glimmer|simple-dom)\// },
			(args) => {
				if (standalonePackages.has(args.path)) return undefined;
				const internal = join(
					cwd,
					'node_modules/ember-source/dist/packages',
					args.path,
					'index.js'
				);
				if (existsSync(internal)) return { path: internal };

				return undefined;
			}
		);
	}
});

/**
 * Wrap a preprocessed page module in a render harness. The harness:
 *  - imports the page module (default export = component)
 *  - imports renderComponent + simple-dom so they bundle together
 *    with the page (single state-bearing module instance, no
 *    "two copies of @glimmer/runtime" hazard)
 *  - exports a `renderToHTML(props)` function the page handler calls
 *
 * The polyfill check for `globalThis.Element` is the LAST thing the
 * harness does before calling renderComponent — Phase 1's pageHandler
 * also installs the polyfill before invoking the bundle, but having it
 * here too makes the bundle robust to being called in isolation.
 */
// EMBER_BANDAID #3 — see `docs/EMBER_BANDAID.md`. Drop `installSimpleDomGlobals`
// once `@ember/renderer` stops doing `into instanceof Element` against
// the global Element constructor (upstream renderer fix needed).
const generateServerHarness = (pageModulePath: string) => `\
import PageComponent from ${JSON.stringify(pageModulePath)};
import { renderComponent } from '@ember/renderer';
import Document from '@simple-dom/document';
import Serializer from '@simple-dom/serializer';

const installSimpleDomGlobals = () => {
	const g = globalThis;
	if (typeof g.Element === 'undefined') g.Element = class Element {};
	if (typeof g.Node === 'undefined') g.Node = class Node {};
};

export const renderToHTML = (props = {}) => {
	installSimpleDomGlobals();
	const doc = new Document();
	const root = doc.createElement('div');
	const result = renderComponent(PageComponent, {
		owner: {},
		env: { document: doc, hasDOM: true, isInteractive: false },
		into: root,
		args: props,
	});
	const serializer = new Serializer({});
	const html = serializer.serialize(root);
	result?.destroy?.();
	return html;
};

export { PageComponent };
export default PageComponent;
`;

/**
 * Compile a single Ember page entry. Returns the absolute paths of the
 * server-side bundled output and the client-side raw module.
 *
 *  Server side: full Bun.build pass that inlines the Glimmer runtime,
 *  simple-dom, and the renderer. The output exports `renderToHTML(props)`
 *  which the page handler calls. Bundling everything into one file
 *  guarantees a single state-bearing module instance — no "two copies
 *  of @glimmer/runtime" hazard.
 *
 *  Client side: just the transpiled module (no bundle). The framework's
 *  client bundle pass picks it up alongside other client entries and
 *  externalizes the Ember runtime to the vendor URLs.
 */
export const compileEmberFile = async (
	entry: string,
	compiledRoot: string,
	cwd: string = process.cwd()
) => {
	const resolvedEntry = resolve(entry);
	const source = await file(resolvedEntry).text();

	let preprocessed = source;
	if (isTemplateTagFile(resolvedEntry)) {
		const preprocessor = await getPreprocessor();
		const result = preprocessor.process(source, {
			filename: resolvedEntry
		});
		preprocessed = rewriteTemplateEvalToScope(result.code);
	}

	const transpiled = transpiler.transformSync(preprocessed);

	const baseName = basename(resolvedEntry).replace(/\.(gjs|gts|ts|js)$/, '');
	const tmpDir = join(compiledRoot, '_tmp');
	const serverDir = join(compiledRoot, 'server');
	const clientDir = join(compiledRoot, 'client');
	await Promise.all([
		mkdir(tmpDir, { recursive: true }),
		mkdir(serverDir, { recursive: true }),
		mkdir(clientDir, { recursive: true })
	]);

	// Stage the transpiled page module as a tmp file the harness can
	// import by path. Absolute path so `import "<...>"` from the harness
	// resolves regardless of where Bun.build sets its CWD. The bundle
	// inlines its content, so it doesn't need to live past the build.
	const tmpPagePath = resolve(join(tmpDir, `${baseName}.module.js`));
	const tmpHarnessPath = resolve(join(tmpDir, `${baseName}.harness.js`));
	await Promise.all([
		write(tmpPagePath, transpiled),
		write(tmpHarnessPath, generateServerHarness(tmpPagePath))
	]);

	// Map every staged tmp module back to its original source so the
	// resolver plugin can translate relative imports correctly. Currently
	// only the page module gets staged, but the map lets future
	// preprocessor outputs (e.g. inlined component sources) participate.
	const stagedSourceMap = new Map<string, string>([
		[tmpPagePath, resolvedEntry]
	]);

	const serverPath = join(serverDir, `${baseName}.js`);
	const buildResult = await bunBuild({
		entrypoints: [tmpHarnessPath],
		format: 'esm',
		minify: false,
		naming: `${baseName}.js`,
		outdir: serverDir,
		plugins: [
			createEmberServerResolverPlugin(cwd, { stagedSourceMap })
		],
		// `target=bun` so Bun.build emits something Node-runnable; the
		// page handler uses `await import(serverPath)` to load it.
		target: 'bun',
		throw: false
	});
	if (!buildResult.success) {
		console.warn(
			`⚠️ Ember server build for ${baseName} had errors:`,
			buildResult.logs
		);
	}

	// Cleanup tmp staging — keeps the build tree predictable.
	await rm(tmpDir, { force: true, recursive: true });

	// Client output is just the transpiled module. Phase 1 doesn't ship
	// a client bundle pass — once Phase 1.5 wires Ember into core/build.ts,
	// this file becomes the entrypoint for the client bundle.
	const clientPath = join(clientDir, `${baseName}.js`);
	await write(clientPath, transpiled);

	return { clientPath, serverPath } satisfies CompileEmberResult;
};

/**
 * Batch-compile every entry in `entries`. Mirrors `compileSvelte`'s
 * shape so `core/build.ts` can call it the same way.
 */
export const compileEmber = async (
	entries: string[],
	emberDir: string,
	cwd: string = process.cwd(),
	_hmr = false
) => {
	if (entries.length === 0) {
		return {
			clientPaths: [] as string[],
			serverPaths: [] as string[]
		};
	}

	const compiledRoot = getFrameworkGeneratedDir('ember');

	const outputs = await Promise.all(
		entries.map((entry) => compileEmberFile(entry, compiledRoot, cwd))
	);

	return {
		clientPaths: outputs.map((o) => o.clientPath),
		serverPaths: outputs.map((o) => o.serverPath)
	};
};

/**
 * Hot path used by the dev module server: compile a single entry into
 * a tmp dir and return the resulting JS source string. Phase 1 doesn't
 * implement caching here; phase 3 will.
 */
export const compileEmberFileSource = async (entry: string) => {
	const resolvedEntry = resolve(entry);
	const source = await file(resolvedEntry).text();

	let preprocessed = source;
	if (isTemplateTagFile(resolvedEntry)) {
		const preprocessor = await getPreprocessor();
		const result = preprocessor.process(source, {
			filename: resolvedEntry
		});
		preprocessed = rewriteTemplateEvalToScope(result.code);
	}

	return transpiler.transformSync(preprocessed);
};

/**
 * Match the `compileSvelte` API surface so the dev rebuilder can call
 * a stable name. Phase 1 returns the entry directory unchanged — caching
 * lives in `compileEmber` itself, not in a separate cache layer.
 */
export const clearEmberCompilerCache = () => {
	// no-op for Phase 1
};

// Expose dirname helper so consumers can predict where compiled outputs
// land without re-deriving the path scheme. The `emberDir` parameter is
// retained for back-compat with callers but ignored — output now lives
// at <projectRoot>/.absolutejs/generated/ember/ regardless.
export const getEmberCompiledRoot = (_emberDir?: string) =>
	getFrameworkGeneratedDir('ember');

export const getEmberServerCompiledDir = (emberDir: string) =>
	join(getEmberCompiledRoot(emberDir), 'server');

export const getEmberClientCompiledDir = (emberDir: string) =>
	join(getEmberCompiledRoot(emberDir), 'client');

// Re-export so build.ts can call basename/dirname helpers from one place.
export { dirname, basename };
