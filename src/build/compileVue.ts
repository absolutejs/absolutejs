import { BASE_36_RADIX } from '../constants';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve
} from 'node:path';
import type {
	SFCDescriptor,
	compileScript as CompileScriptFn,
	compileStyle as CompileStyleFn,
	compileTemplate as CompileTemplateFn,
	parse as ParseFn
} from '@vue/compiler-sfc';
import { file, write, Transpiler } from 'bun';
import { toKebab } from '../utils/stringModifiers';
import { getFrameworkGeneratedDir } from '../utils/generatedDir';
import { resolvePackageImport } from './resolvePackageImport';
import { buildIslandMetadataExports } from '../islands/sourceMetadata';
import { buildLineRemap, remapGeneratedLines } from './chainInlineSourcemaps';
import { addAutoRouterSetupApp } from './vueAutoRouterTransform';
import {
	addStyleImporter,
	compileStyleSource,
	isStylePath
} from './stylePreprocessor';
import type { StylePreprocessorConfig } from '../../types/build';

const resolveDevClientDir = () => {
	const projectRoot = process.cwd();
	const fromSource = resolve(import.meta.dir, '../dev/client');

	if (existsSync(fromSource) && fromSource.startsWith(projectRoot)) {
		return fromSource;
	}

	const fromNodeModules = resolve(
		projectRoot,
		'node_modules/@absolutejs/absolute/dist/dev/client'
	);
	if (existsSync(fromNodeModules)) return fromNodeModules;

	return resolve(import.meta.dir, './dev/client');
};

const devClientDir = resolveDevClientDir();

const hmrClientPath = join(devClientDir, 'hmrClient.ts').replace(/\\/g, '/');

const transpiler = new Transpiler({ loader: 'ts', target: 'browser' });

type BuildResult = {
	clientPath: string;
	serverPath: string;
	cssPaths: string[];
	cssCodes: string[];
	tsHelperPaths: string[];
	hmrId: string;
};

// HMR change type detection
export type VueChangeType = 'style-only' | 'template-only' | 'script' | 'full';

// Descriptor caches for change detection
const scriptCache = new Map<string, string>();
const scriptSetupCache = new Map<string, string>();
const templateCache = new Map<string, string>();
const styleCache = new Map<string, string>();

// Persistent build result cache across HMR cycles — avoids recompiling unchanged Vue components
const persistentBuildCache = new Map<string, BuildResult>();

// Source content hash cache to detect unchanged files
const vueSourceHashCache = new Map<string, string>();

// HMR metadata storage (exported for rebuildTrigger to access)
export const vueHmrMetadata = new Map<
	string,
	{ hmrId: string; changeType: VueChangeType }
>();
export const clearVueHmrCaches = () => {
	scriptCache.clear();
	scriptSetupCache.clear();
	templateCache.clear();
	styleCache.clear();
	vueHmrMetadata.clear();
	persistentBuildCache.clear();
	vueSourceHashCache.clear();
};

export const detectVueChangeType = (
	filePath: string,
	descriptor: SFCDescriptor
) => {
	const prevScript = scriptCache.get(filePath);
	const prevScriptSetup = scriptSetupCache.get(filePath);
	const prevTemplate = templateCache.get(filePath);
	const prevStyle = styleCache.get(filePath);

	const currentScript = descriptor.script?.content ?? '';
	const currentScriptSetup = descriptor.scriptSetup?.content ?? '';
	const currentTemplate = descriptor.template?.content ?? '';
	// Serialize styles: include scoped flag and content for each style block
	// Uses ||| delimiter to detect changes to any block, additions, removals, or reordering
	const currentStyle = descriptor.styles
		.map((s) => `${s.scoped ? 'scoped:' : ''}${s.content}`)
		.join('|||');

	// Update caches with current values
	scriptCache.set(filePath, currentScript);
	scriptSetupCache.set(filePath, currentScriptSetup);
	templateCache.set(filePath, currentTemplate);
	styleCache.set(filePath, currentStyle);

	// First compile - no previous data
	if (prevScript === undefined && prevScriptSetup === undefined) {
		return 'full';
	}

	const scriptChanged = prevScript !== currentScript;
	const scriptSetupChanged = prevScriptSetup !== currentScriptSetup;
	const templateChanged = prevTemplate !== currentTemplate;
	const styleChanged = prevStyle !== currentStyle;

	// Priority order:
	// 1. Script changes → 'script' (requires reload)
	// 2. Template-only (no script, no style) → 'template-only' (rerender)
	// 3. Style-only (no script, no template) → 'style-only' (CSS hot-swap, state preserved)
	// 4. Template + style → 'template-only' (CSS swapped alongside rerender)

	// Script change: script or scriptSetup changed (may also include template/style)
	if (scriptChanged || scriptSetupChanged) {
		return 'script';
	}

	// Style-only change: only styles changed, no script or template
	if (styleChanged && !templateChanged) {
		return 'style-only';
	}

	// Template-only change: template changed (with or without styles), script unchanged
	if (templateChanged) {
		return 'template-only';
	}

	// No changes detected (shouldn't happen in practice)
	return 'full';
};
export const generateVueHmrId = (sourceFilePath: string, vueRootDir: string) =>
	relative(vueRootDir, sourceFilePath)
		.replace(/\\/g, '/')
		.replace(/\.vue$/, '');

const extractImports = (sourceCode: string) =>
	Array.from(sourceCode.matchAll(/import\s+[\s\S]+?['"]([^'"]+)['"]/g))
		.map((match) => match[1])
		.filter((importPath): importPath is string => importPath !== undefined);

// Inline `@import "rel.css"` / `@import url("rel.css")` statements in a
// Vue <style> block by reading the referenced file and embedding its
// contents. Done before compileStyle so the scoped-class hashing
// applies uniformly across imported content, and so the concatenated
// bundle has no `@import` rules to keep in spec-required order. Bare
// (non-relative) imports are preserved — those resolve through the
// regular CSS loader chain.
const inlineCssImports = (
	cssContent: string,
	cssFilePath: string,
	visited: Set<string> = new Set()
): string => {
	const resolved = realpathSync(cssFilePath);
	if (visited.has(resolved)) return '';
	visited.add(resolved);

	const importRegex
		= /@import\s+(?:url\(\s*)?(['"])(\.{1,2}\/[^'"]+)\1\s*\)?\s*;?/g;

	return cssContent.replace(importRegex, (match, _quote, relPath) => {
		const importedPath = resolve(dirname(cssFilePath), relPath);
		if (!existsSync(importedPath)) return match;
		const importedContent = readFileSync(importedPath, 'utf-8');

		return inlineCssImports(importedContent, importedPath, visited);
	});
};

// Resolve a relative .ts helper import to an actual file path. Mirrors
// node's resolution: if `<dir>/<helper>.ts` doesn't exist, try
// `<dir>/<helper>/index.ts` so callers can import a directory module.
const resolveHelperTsPath = (sourceDir: string, helper: string) => {
	if (helper.endsWith('.ts')) return resolve(sourceDir, helper);
	const direct = resolve(sourceDir, `${helper}.ts`);
	if (existsSync(direct)) return direct;
	const indexed = resolve(sourceDir, helper, 'index.ts');
	if (existsSync(indexed)) return indexed;

	return direct;
};

const toJs = (filePath: string, sourceDir?: string) => {
	if (filePath.endsWith('.vue')) return filePath.replace(/\.vue$/, '.js');
	if (filePath.endsWith('.ts')) return filePath.replace(/\.ts$/, '.js');
	// Style imports (.css / .module.scss / .less / .styl / etc.) keep their
	// original extension — the bun-side style preprocessor plugin loads them
	// directly. Appending `.js` would break the resolver and the build.
	//
	// We also rewrite relative style imports to absolute paths so they
	// resolve correctly: the compiled .js lives in `generated/{mode}/...`
	// (a different directory tree than the source), and a bare `./foo.scss`
	// would point to the wrong location once the bundler runs from the
	// output directory.
	if (isStylePath(filePath)) {
		if (
			sourceDir &&
			(filePath.startsWith('./') || filePath.startsWith('../'))
		) {
			return resolve(sourceDir, filePath);
		}

		return filePath;
	}

	// Bare relative import without extension — could be a `.ts` file or a
	// directory with `index.ts`. Probe the filesystem so callers can write
	// `import x from "../state"` against a `state/index.ts` directory module.
	if (
		sourceDir &&
		(filePath.startsWith('./') || filePath.startsWith('../'))
	) {
		const directTs = resolve(sourceDir, `${filePath}.ts`);
		if (existsSync(directTs)) return `${filePath}.js`;
		const indexedTs = resolve(sourceDir, filePath, 'index.ts');
		if (existsSync(indexedTs)) return `${filePath}/index.js`;
	}

	return `${filePath}.js`;
};

const stripExports = (code: string) =>
	// Only strip `export default ...` (the SFC script object) — `assembleModule`
	// re-emits `export default script` at the end. User-defined named exports
	// from a plain `<script>` block (e.g. `export const setupApp = ...` for
	// vue-router cooperation) MUST be preserved so the auto-generated client
	// index can import them via `import * as PageModule`.
	code.replace(/export\s+default/, 'const script =');

const mergeVueImports = (code: string) => {
	const lines = code.split('\n');
	const specifierSet = new Set<string>();
	const vueImportRegex = /^import\s+{([^}]+)}\s+from\s+['"]vue['"];?$/;

	lines.forEach((line) => {
		const match = line.match(vueImportRegex);
		if (match?.[1])
			match[1]
				.split(',')
				.forEach((importSpecifier) =>
					specifierSet.add(importSpecifier.trim())
				);
	});

	const nonVueLines = lines.filter((line) => !vueImportRegex.test(line));

	return specifierSet.size
		? [
				`import { ${[...specifierSet].join(', ')} } from "vue";`,
				...nonVueLines
			].join('\n')
		: nonVueLines.join('\n');
};

type VueCompiler = {
	parse: typeof ParseFn;
	compileScript: typeof CompileScriptFn;
	compileTemplate: typeof CompileTemplateFn;
	compileStyle: typeof CompileStyleFn;
};

// addAutoRouterSetupApp moved to ./vueAutoRouterTransform — shared
// with the dev module server (src/dev/moduleServer.ts) so the auto
// router is present in every served version of a page module.

const compileVueFile = async (
	sourceFilePath: string,
	outputDirs: { client: string; server: string; css: string },
	cacheMap: Map<string, BuildResult>,
	isEntryPoint: boolean,
	vueRootDir: string,
	compiler: VueCompiler,
	stylePreprocessors?: StylePreprocessorConfig
) => {
	const cachedResult = cacheMap.get(sourceFilePath);
	if (cachedResult) return cachedResult;

	const relativeFilePath = relative(vueRootDir, sourceFilePath).replace(
		/\\/g,
		'/'
	);
	const relativeWithoutExtension = relativeFilePath.replace(/\.vue$/, '');
	const fileBaseName = basename(sourceFilePath, '.vue');
	const componentId = toKebab(fileBaseName);

	const rawSourceContent = await file(sourceFilePath).text();
	// Pages exporting `routes` get an auto-synthesized setupApp that owns
	// the vue-router lifecycle, using the page bundle's own vue-router
	// instance (avoids dual-instance provide/inject mismatches).
	const sourceContent = isEntryPoint
		? addAutoRouterSetupApp(rawSourceContent)
		: rawSourceContent;
	const islandMetadataExports = buildIslandMetadataExports(sourceContent);

	// Check persistent cache — skip recompilation if source unchanged AND
	// the compiled outputs still exist on disk. The disk check matters
	// because an outer process (incremental build, test cleanup, manual
	// clean of `.absolutejs/generated`) can remove intermediates while
	// the in-memory cache still believes they're present; bundling the
	// entry would then fail with `Could not resolve "../components/..."`.
	const contentHash = Bun.hash(sourceContent).toString(BASE_36_RADIX);
	const prevHash = vueSourceHashCache.get(sourceFilePath);
	const persistent = persistentBuildCache.get(sourceFilePath);

	if (
		prevHash === contentHash &&
		persistent &&
		existsSync(persistent.clientPath) &&
		existsSync(persistent.serverPath)
	) {
		cacheMap.set(sourceFilePath, persistent);

		return persistent;
	}

	vueSourceHashCache.set(sourceFilePath, contentHash);
	const { descriptor } = compiler.parse(sourceContent, {
		filename: sourceFilePath
	});

	// Generate HMR ID and detect change type
	const hmrId = generateVueHmrId(sourceFilePath, vueRootDir);
	const changeType = detectVueChangeType(sourceFilePath, descriptor);

	// Store HMR metadata for rebuildTrigger to access
	vueHmrMetadata.set(sourceFilePath, { changeType, hmrId });

	const scriptSource =
		descriptor.scriptSetup?.content ?? descriptor.script?.content ?? '';

	// SFCs may declare BOTH `<script>` (module-level — exports like `routes`
	// or `setupApp`) and `<script setup>` (component-scoped). Both can pull
	// in further .vue components or helpers that need to be in the build
	// graph, so collect imports from both blocks even though only setupApp
	// is what runs at component creation time.
	const moduleScriptSource =
		descriptor.script?.content && descriptor.scriptSetup
			? descriptor.script.content
			: '';
	const importPaths = [
		...extractImports(scriptSource),
		...extractImports(moduleScriptSource)
	];

	// Resolve bare module imports that point to .vue files
	const resolvedPackageVueImports = new Map<string, string>();
	const bareImports = importPaths.filter(
		(p) => !p.startsWith('.') && !p.startsWith('/')
	);
	for (const importPath of bareImports) {
		const resolved = resolvePackageImport(importPath);
		if (!resolved?.endsWith('.vue')) continue;
		resolvedPackageVueImports.set(importPath, resolved);
	}

	const childComponentPaths = importPaths.filter(
		(path) => path.startsWith('.') && path.endsWith('.vue')
	);
	const packageComponentPaths = Array.from(
		resolvedPackageVueImports.entries()
	);
	// Helper modules are TS/JS imports that need to be transpiled and copied
	// alongside the component (e.g. shared utilities). Style imports including
	// CSS modules (.module.scss / .module.less / .module.styl / .module.css)
	// are handled by the bun-side style preprocessor plugin and must not be
	// treated as TS helpers — otherwise we'd try to read the source as a `.ts`
	// file and crash at build time.
	const helperModulePaths = importPaths.filter(
		(path) =>
			path.startsWith('.') && !path.endsWith('.vue') && !isStylePath(path)
	);

	// Record JS → CSS-module imports for HMR dep tracking. When a Vue
	// component imports a `.module.scss`, an edit to that style file
	// has to invalidate the importing component's bundle so the new
	// hashed class names land in the served output.
	const stylePathsImported = importPaths
		.filter(
			(path) =>
				(path.startsWith('.') || isAbsolute(path)) && isStylePath(path)
		)
		.map((path) =>
			isAbsolute(path) ? path : resolve(dirname(sourceFilePath), path)
		);
	for (const stylePath of stylePathsImported) {
		addStyleImporter(sourceFilePath, stylePath);
	}

	const childBuildResults: BuildResult[] = await Promise.all([
		...childComponentPaths.map((relativeChildPath) =>
			compileVueFile(
				resolve(dirname(sourceFilePath), relativeChildPath),
				outputDirs,
				cacheMap,
				false,
				vueRootDir,
				compiler,
				stylePreprocessors
			)
		),
		...packageComponentPaths.map(([, absolutePath]) =>
			compileVueFile(
				absolutePath,
				outputDirs,
				cacheMap,
				false,
				vueRootDir,
				compiler,
				stylePreprocessors
			)
		)
	]);

	const hasScript = descriptor.script || descriptor.scriptSetup;
	// Vue's compileScript falls back to `typescript.sys` for filesystem
	// access when resolving cross-file type references in
	// `defineProps<ImportedType>()`. That fallback is dynamic-required
	// inside @vue/compiler-sfc and isn't always loaded under Bun, so
	// pass an explicit fs adapter — without it any page that uses an
	// imported type as its props alias errors with
	// "No fs option provided to compileScript in non-Node environment".
	const compiledScript = hasScript
		? compiler.compileScript(descriptor, {
				fs: {
					fileExists: existsSync,
					readFile: (file) =>
						existsSync(file)
							? readFileSync(file, 'utf-8')
							: undefined,
					realpath: realpathSync
				},
				id: componentId,
				inlineTemplate: false,
				sourceMap: true
			})
		: { bindings: {}, content: 'export default {};', map: undefined };
	const strippedScript = stripExports(compiledScript.content);
	const sourceDir = dirname(sourceFilePath);
	const transpiledScript = transpiler
		.transformSync(strippedScript)
		.replace(
			/(['"])(\.{1,2}\/[^'"]+)(['"])/g,
			(_, quoteStart, relativeImport, quoteEnd) =>
				`${quoteStart}${toJs(relativeImport, sourceDir)}${quoteEnd}`
		);

	// Build rewrite map for bare module .vue imports → compiled output paths
	const packageImportRewrites = new Map<
		string,
		{ client: string; server: string }
	>();
	for (const [bareImport, absolutePath] of packageComponentPaths) {
		const childResult = cacheMap.get(absolutePath);
		if (!childResult) continue;

		packageImportRewrites.set(bareImport, {
			client: childResult.clientPath,
			server: childResult.serverPath
		});
	}

	const generateRenderFunction = (ssr: boolean) => {
		const rendered = compiler.compileTemplate({
			compilerOptions: {
				bindingMetadata: compiledScript.bindings,
				expressionPlugins: ['typescript'],
				isCustomElement: (tag) => tag === 'absolute-island',
				prefixIdentifiers: true
			},
			filename: sourceFilePath,
			id: componentId,
			scoped: descriptor.styles.some(
				(styleBlock) => styleBlock.scoped
			),
			source: descriptor.template?.content ?? '',
			ssr,
			ssrCssVars: descriptor.cssVars
		}).code;

		// `expressionPlugins: ['typescript']` lets compileTemplate accept
		// TS syntax inside template bindings (e.g. `($event.target as
		// HTMLInputElement).value`) but it doesn't strip the assertions
		// from the emitted render code, so the cast leaks into the JS
		// output and Bun's bundler parses it as a syntax error. Run the
		// render output through Bun's TS transpiler before path rewriting.
		return transpiler
			.transformSync(rendered)
			.replace(
				/(['"])(\.{1,2}\/[^'"]+)(['"])/g,
				(_, quoteStart, relativeImport, quoteEnd) =>
					`${quoteStart}${toJs(relativeImport, sourceDir)}${quoteEnd}`
			);
	};

	const localCss = await Promise.all(
		descriptor.styles.map(async (styleBlock) => {
			const rawContent = styleBlock.lang
				? await compileStyleSource(
						sourceFilePath,
						styleBlock.content,
						styleBlock.lang,
						stylePreprocessors
					)
				: styleBlock.content;

			return compiler.compileStyle({
				filename: sourceFilePath,
				id: componentId,
				scoped: styleBlock.scoped,
				source: inlineCssImports(rawContent, sourceFilePath),
				trim: true
			}).code;
		})
	);
	const allCss = [
		...localCss,
		...childBuildResults.flatMap((result) => result.cssCodes)
	];

	let cssOutputPaths: string[] = [];
	if (isEntryPoint && allCss.length) {
		const cssOutputFile = join(
			outputDirs.css,
			`${toKebab(fileBaseName)}-compiled.css`
		);
		await mkdir(dirname(cssOutputFile), { recursive: true });
		await write(cssOutputFile, allCss.join('\n'));
		cssOutputPaths = [cssOutputFile];
	}

	const assembleModule = (
		renderCode: string,
		renderFnName: 'render' | 'ssrRender',
		includeHmr: boolean
	) => {
		const hasScoped = descriptor.styles.some(
			(styleBlock) => styleBlock.scoped
		);

		// __scopeId is required for Vue runtime to add scoped style attributes to dynamic elements
		// Without this, scoped styles only work on static VNodes that have the attribute baked in
		const scopeIdCode = hasScoped
			? `script.__scopeId = "data-v-${componentId}";`
			: '';

		// For client bundles, inject HMR registration code that uses Vue's native __VUE_HMR_RUNTIME__
		// This enables state-preserving hot updates via rerender() for template changes
		// and reload() for script changes
		const hmrCode = includeHmr
			? `
// Vue Native HMR Registration
script.__hmrId = ${JSON.stringify(hmrId)};
if (typeof __VUE_HMR_RUNTIME__ !== 'undefined') {
  __VUE_HMR_RUNTIME__.createRecord(script.__hmrId, script);
  if (typeof window !== 'undefined') {
    window.__VUE_HMR_COMPONENTS__ = window.__VUE_HMR_COMPONENTS__ || {};
    window.__VUE_HMR_COMPONENTS__[script.__hmrId] = script;
  }
}`
			: '';

		return mergeVueImports(
			[
				transpiledScript,
				renderCode,
				`script.${renderFnName} = ${renderFnName};`,
				scopeIdCode,
				hmrCode,
				'export default script;'
			].join('\n')
		);
	};

	// Client bundles include HMR registration code; server bundles do not
	const clientCode =
		assembleModule(generateRenderFunction(false), 'render', true) +
		islandMetadataExports;
	const serverCode =
		assembleModule(generateRenderFunction(true), 'ssrRender', false) +
		islandMetadataExports;

	const clientOutputPath = join(
		outputDirs.client,
		`${relativeWithoutExtension}.js`
	);
	const serverOutputPath = join(
		outputDirs.server,
		`${relativeWithoutExtension}.js`
	);

	// Rewrite bare module imports to relative paths pointing at compiled output
	const rewritePackageImports = (
		code: string,
		outputPath: string,
		mode: 'client' | 'server'
	) => {
		let result = code;
		for (const [bareImport, paths] of packageImportRewrites) {
			const targetPath = mode === 'server' ? paths.server : paths.client;
			let rel = relative(dirname(outputPath), targetPath).replace(
				/\\/g,
				'/'
			);
			if (!rel.startsWith('.')) rel = `./${rel}`;
			result = result.replaceAll(bareImport, rel);
		}

		return result;
	};

	await mkdir(dirname(clientOutputPath), { recursive: true });
	await mkdir(dirname(serverOutputPath), { recursive: true });

	const clientFinal = rewritePackageImports(
		clientCode,
		clientOutputPath,
		'client'
	);
	const serverFinal = rewritePackageImports(
		serverCode,
		serverOutputPath,
		'server'
	);

	// Inline sourcemap: chain compileScript's map (compileScript-line
	// → .vue line) through a content-derived line remap that captures
	// every later non-line-preserving transform (Bun.Transpiler blank-
	// line drops, mergeVueImports consolidation, etc.). Bun.build then
	// composes this through to the final hashed bundle when invoked
	// with `sourcemap: 'inline'`, and `chainBundleInlineSourcemap`
	// stitches Bun.build's output map onto this one because Bun.build
	// itself doesn't chain through input inline sourcemaps yet
	// (docs/BUN_SOURCEMAP_CHAIN_BUG.md).
	const inlineSourceMapFor = (finalContent: string) => {
		if (!compiledScript.map || !hasScript) return '';
		const remap = buildLineRemap(strippedScript, finalContent);
		const mappings = remapGeneratedLines(
			compiledScript.map.mappings,
			remap
		);
		const map = { ...compiledScript.map, mappings };
		return `\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(
			JSON.stringify(map)
		).toString('base64')}\n`;
	};

	await write(
		clientOutputPath,
		clientFinal + inlineSourceMapFor(clientFinal)
	);
	await write(
		serverOutputPath,
		serverFinal + inlineSourceMapFor(serverFinal)
	);

	const result: BuildResult = {
		clientPath: clientOutputPath,
		cssCodes: allCss,
		cssPaths: cssOutputPaths,
		hmrId,
		serverPath: serverOutputPath,
		tsHelperPaths: [
			...helperModulePaths.map((helper) =>
				resolveHelperTsPath(dirname(sourceFilePath), helper)
			),
			...childBuildResults.flatMap((child) => child.tsHelperPaths)
		]
	};

	cacheMap.set(sourceFilePath, result);
	persistentBuildCache.set(sourceFilePath, result);

	return result;
};

export const compileVue = async (
	entryPoints: string[],
	vueRootDir: string,
	isDev = false,
	stylePreprocessors?: StylePreprocessorConfig,
	ssrOnlyEntries?: ReadonlySet<string>
) => {
	const compiler: VueCompiler = await import('@vue/compiler-sfc');

	// Generated output lives at <projectRoot>/.absolutejs/generated/vue/.
	// See `src/utils/generatedDir.ts` for rationale (keeps `src/` clean).
	const generatedDir = getFrameworkGeneratedDir('vue');
	const clientOutputDir = join(generatedDir, 'client');
	const indexOutputDir = join(generatedDir, 'indexes');
	const serverOutputDir = join(generatedDir, 'server');
	const cssOutputDir = join(generatedDir, 'compiled');

	await Promise.all([
		mkdir(clientOutputDir, { recursive: true }),
		mkdir(indexOutputDir, { recursive: true }),
		mkdir(serverOutputDir, { recursive: true }),
		mkdir(cssOutputDir, { recursive: true })
	]);

	const buildCache = new Map<string, BuildResult>();
	const allTsHelperPaths = new Set<string>();

	const compiledPages = await Promise.all(
		entryPoints.map(async (entryPath) => {
			const resolvedEntryPath = resolve(entryPath);
			const result = await compileVueFile(
				resolvedEntryPath,
				{
					client: clientOutputDir,
					css: cssOutputDir,
					server: serverOutputDir
				},
				buildCache,
				true,
				vueRootDir,
				compiler,
				stylePreprocessors
			);

			result.tsHelperPaths.forEach((path) => allTsHelperPaths.add(path));

			// SSR-only entries (flagged `client: 'none'` at registration
			// time, see `scanVueSsrOnlyPages`) skip the per-page client
			// hydration index entirely — no `<script type="module">`
			// ships, no manifest entry, no bundler work for the client
			// path. The server bundle and per-page CSS still emit so the
			// SSR handler can render the page.
			if (ssrOnlyEntries?.has(resolvedEntryPath)) {
				return {
					clientPath: null,
					cssPaths: result.cssPaths,
					indexPath: null,
					serverPath: result.serverPath
				};
			}

			const entryBaseName = basename(entryPath, '.vue');
			const indexOutputFile = join(indexOutputDir, `${entryBaseName}.js`);
			const clientOutputFile = join(
				clientOutputDir,
				relative(vueRootDir, entryPath)
					.replace(/\\/g, '/')
					.replace(/\.vue$/, '.js')
			);

			await mkdir(dirname(indexOutputFile), { recursive: true });
			const vueHmrImports = isDev
				? [
						`window.__HMR_FRAMEWORK__ = "vue";`,
						`import "${hmrClientPath}";`
					]
				: [];
			await write(
				indexOutputFile,
				[
					...vueHmrImports,
					`import Comp, * as PageModule from "${relative(dirname(indexOutputFile), clientOutputFile).replace(/\\/g, '/')}";`,
					'import { createSSRApp, createApp } from "vue";',
					'',
					'// HMR State Preservation: Check for preserved state from HMR',
					'let preservedState = (typeof window !== "undefined" && window.__HMR_PRESERVED_STATE__) ? window.__HMR_PRESERVED_STATE__ : {};',
					'',
					'// Fallback: check sessionStorage if window state is empty (only during active HMR, not full page refresh)',
					'if (typeof window !== "undefined" && Object.keys(preservedState).length === 0 && sessionStorage.getItem("__HMR_ACTIVE__")) {',
					'  try {',
					'    const stored = sessionStorage.getItem("__VUE_HMR_STATE__");',
					'    if (stored) {',
					'      preservedState = JSON.parse(stored);',
					'      sessionStorage.removeItem("__VUE_HMR_STATE__");',
					'    }',
					'  } catch (e) {}',
					'}',
					'// Clean up stale HMR state on full page refresh',
					'if (typeof window !== "undefined" && !sessionStorage.getItem("__HMR_ACTIVE__")) {',
					'  sessionStorage.removeItem("__VUE_HMR_STATE__");',
					'}',
					'',
					'const initialProps = window.__INITIAL_PROPS__ ?? {};',
					'// Only merge preserved state keys that match declared props (avoids passing refs/components as attributes)',
					'const mergedProps = { ...initialProps };',
					'Object.keys(preservedState).forEach(function(key) {',
					'  if (key in initialProps) {',
					'    mergedProps[key] = preservedState[key];',
					'  }',
					'});',
					'',
					'// During HMR or after SSR dirty, use createApp (fresh mount) to avoid hydration mismatch with stale DOM',
					'const isHMR = typeof window !== "undefined" && sessionStorage.getItem("__HMR_ACTIVE__");',
					'const isSsrDirty = typeof window !== "undefined" && window.__SSR_DIRTY__;',
					'const shouldHydrate = typeof window === "undefined" ? false : !(isHMR || isSsrDirty);',
					'const app = shouldHydrate ? createSSRApp(Comp, mergedProps) : createApp(Comp, mergedProps);',
					'',
					"// `setupApp` hook. Reflect.get hides the lookup from Bun's",
					"// static analyzer so non-SPA pages without it don't trigger",
					'// "always undefined" warnings. Pages that export `routes`',
					'// have their setupApp auto-synthesized at compile time by',
					'// compileVue (see addAutoRouterSetupApp below) — that wrapper',
					"// uses the page-bundle's own vue-router instance so",
					'// provide/inject symbols match between the router and the',
					"// page's `useRoute()` calls.",
					'const setupAppHook = Reflect.get(PageModule, "setupApp");',
					'async function bootstrapApp() {',
					'  if (typeof setupAppHook === "function") {',
					'    const clientUrl = typeof window !== "undefined"',
					'      ? window.location.pathname + window.location.search',
					'      : "/";',
					'    await setupAppHook(app, {',
					'      isServer: false,',
					'      router: null,',
					'      setRedirect: () => {},',
					'      url: clientUrl',
					'    });',
					'  }',
					'  app.mount("#root");',
					'}',
					'bootstrapApp();',
					'',
					'// Store app instance for HMR - used for manual component updates',
					'if (typeof window !== "undefined") {',
					'  window.__VUE_APP__ = app;',
					'}',
					'',
					'// Post-mount: Apply preserved state to reactive refs in component tree',
					'// This restores state that lives in refs (like count) rather than props',
					'if (typeof window !== "undefined" && Object.keys(preservedState).length > 0) {',
					'  requestAnimationFrame(function() {',
					'    if (window.__VUE_APP__ && window.__VUE_APP__._instance) {',
					'      applyPreservedState(window.__VUE_APP__._instance, preservedState);',
					'    }',
					'  });',
					'}',
					'',
					'function applyPreservedState(instance, state) {',
					'  // Apply to root component setupState',
					'  if (instance.setupState) {',
					'    Object.keys(state).forEach(function(key) {',
					'      const ref = instance.setupState[key];',
					'      if (ref && typeof ref === "object" && "value" in ref) {',
					'        ref.value = state[key];',
					'      }',
					'    });',
					'  }',
					'  // Also apply to child components',
					'  if (instance.subTree) {',
					'    walkAndApply(instance.subTree, state);',
					'  }',
					'}',
					'',
					'function walkAndApply(vnode, state) {',
					'  if (!vnode) return;',
					'  if (vnode.component && vnode.component.setupState) {',
					'    Object.keys(state).forEach(function(key) {',
					'      const ref = vnode.component.setupState[key];',
					'      if (ref && typeof ref === "object" && "value" in ref) {',
					'        ref.value = state[key];',
					'      }',
					'    });',
					'  }',
					'  if (vnode.children && Array.isArray(vnode.children)) {',
					'    vnode.children.forEach(function(child) { walkAndApply(child, state); });',
					'  }',
					'  if (vnode.component && vnode.component.subTree) {',
					'    walkAndApply(vnode.component.subTree, state);',
					'  }',
					'}',
					'',
					'// Clear preserved state after applying',
					'if (typeof window !== "undefined") {',
					'  window.__ABS_SLOT_HYDRATION_PENDING__ = shouldHydrate;',
					'  var releaseStreamingSlots = function() {',
					'    window.__ABS_SLOT_HYDRATION_PENDING__ = false;',
					'    if (typeof window.__ABS_SLOT_FLUSH__ === "function") {',
					'      window.__ABS_SLOT_FLUSH__();',
					'    }',
					'  };',
					'  if (shouldHydrate && typeof requestAnimationFrame === "function") {',
					'    requestAnimationFrame(function() {',
					'      requestAnimationFrame(releaseStreamingSlots);',
					'    });',
					'  } else if (typeof window.__ABS_SLOT_FLUSH__ === "function") {',
					'    window.__ABS_SLOT_FLUSH__();',
					'  } else if (typeof setTimeout === "function") {',
					'    setTimeout(releaseStreamingSlots, 0);',
					'  }',
					'}',
					'if (typeof window !== "undefined") {',
					'  window.__HMR_PRESERVED_STATE__ = undefined;',
					'}'
				].join('\n')
			);

			return {
				clientPath: clientOutputFile,
				cssPaths: result.cssPaths,
				indexPath: indexOutputFile,
				serverPath: result.serverPath
			};
		})
	);

	// Recursively trace .ts helpers. Helpers can import other helpers
	// (e.g. `state/index.ts` re-exports `./auth`, `./profile`), and those
	// transitive dependencies need to be transpiled + copied too so their
	// relative `import "./auth"` resolves in the generated tree.
	const queue = Array.from(allTsHelperPaths);
	while (queue.length > 0) {
		const tsPath = queue.shift();
		if (!tsPath) continue;
		const sourceCode = await file(tsPath).text();
		const helperDir = dirname(tsPath);
		for (const dep of extractImports(sourceCode)) {
			if (!dep.startsWith('.') || isStylePath(dep) || dep.endsWith('.vue')) {
				continue;
			}
			const resolved = resolveHelperTsPath(helperDir, dep);
			if (!existsSync(resolved)) continue;
			if (allTsHelperPaths.has(resolved)) continue;
			allTsHelperPaths.add(resolved);
			queue.push(resolved);
		}
	}

	await Promise.all(
		Array.from(allTsHelperPaths).map(async (tsPath) => {
			const sourceCode = await file(tsPath).text();
			const transpiledCode = transpiler.transformSync(sourceCode);
			const relativeJsPath = relative(vueRootDir, tsPath).replace(
				/\.ts$/,
				'.js'
			);
			const outClientPath = join(clientOutputDir, relativeJsPath);
			const outServerPath = join(serverOutputDir, relativeJsPath);
			await mkdir(dirname(outClientPath), { recursive: true });
			await mkdir(dirname(outServerPath), { recursive: true });
			await write(outClientPath, transpiledCode);
			await write(outServerPath, transpiledCode);
		})
	);

	const isString = (value: string | null): value is string => value !== null;

	return {
		// Export HMR metadata from vueHmrMetadata map (populated during compilation)
		hmrMetadata: new Map(vueHmrMetadata),
		vueClientPaths: compiledPages.map((p) => p.clientPath).filter(isString),
		vueCssPaths: compiledPages.flatMap((result) => result.cssPaths),
		vueIndexPaths: compiledPages.map((p) => p.indexPath).filter(isString),
		vueServerPaths: compiledPages.map((result) => result.serverPath)
	};
};
