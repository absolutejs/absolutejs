import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import {
	parse,
	compileScript,
	compileTemplate,
	compileStyle,
	type SFCDescriptor
} from '@vue/compiler-sfc';
import { file, write, Transpiler } from 'bun';
import { toKebab } from '../utils/stringModifiers';

const devClientDir = (() => {
	const fromSource = resolve(import.meta.dir, '../dev/client');
	if (existsSync(fromSource)) return fromSource;

	return resolve(import.meta.dir, './dev/client');
})();

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

// HMR metadata storage (exported for rebuildTrigger to access)
export const vueHmrMetadata = new Map<
	string,
	{ hmrId: string; changeType: VueChangeType }
>();

/**
 * Detect what type of change occurred in a Vue component
 * Returns 'template-only' for template changes (supports rerender)
 * Returns 'script' for script/scriptSetup changes (requires reload)
 * Returns 'full' for first compile or when detection fails
 */
export const detectVueChangeType = (
	filePath: string,
	descriptor: SFCDescriptor
): VueChangeType => {
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

/**
 * Generate a stable HMR ID for a Vue component
 * Uses relative path from Vue root without extension
 * Example: "pages/VueExample" or "components/CountButton"
 */
export const generateVueHmrId = (
	sourceFilePath: string,
	vueRootDir: string
): string => {
	return relative(vueRootDir, sourceFilePath)
		.replace(/\\/g, '/')
		.replace(/\.vue$/, '');
};

/**
 * Clear HMR caches (useful for testing or full rebuilds)
 */
export const clearVueHmrCaches = () => {
	scriptCache.clear();
	scriptSetupCache.clear();
	templateCache.clear();
	styleCache.clear();
	vueHmrMetadata.clear();
};

const extractImports = (sourceCode: string) =>
	Array.from(sourceCode.matchAll(/import\s+[\s\S]+?['"]([^'"]+)['"]/g))
		.map((match) => match[1])
		.filter((importPath): importPath is string => importPath !== undefined);

const toJs = (filePath: string) => {
	if (filePath.endsWith('.vue')) return filePath.replace(/\.vue$/, '.js');
	if (filePath.endsWith('.ts')) return filePath.replace(/\.ts$/, '.js');

	return `${filePath}.js`;
};

const stripExports = (code: string) =>
	code
		.replace(/export\s+default/, 'const script =')
		.replace(/^export\s+/gm, '');

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

const compileVueFile = async (
	sourceFilePath: string,
	outputDirs: { client: string; server: string; css: string },
	cacheMap: Map<string, BuildResult>,
	isEntryPoint: boolean,
	vueRootDir: string
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

	const sourceContent = await file(sourceFilePath).text();
	const { descriptor } = parse(sourceContent, { filename: sourceFilePath });

	// Generate HMR ID and detect change type
	const hmrId = generateVueHmrId(sourceFilePath, vueRootDir);
	const changeType = detectVueChangeType(sourceFilePath, descriptor);

	// Store HMR metadata for rebuildTrigger to access
	vueHmrMetadata.set(sourceFilePath, { hmrId, changeType });

	const scriptSource =
		descriptor.scriptSetup?.content ?? descriptor.script?.content ?? '';

	const importPaths = extractImports(scriptSource);
	const childComponentPaths = importPaths.filter(
		(path) => path.startsWith('.') && path.endsWith('.vue')
	);
	const helperModulePaths = importPaths.filter(
		(path) => path.startsWith('.') && !path.endsWith('.vue')
	);

	const childBuildResults: BuildResult[] = await Promise.all(
		childComponentPaths.map((relativeChildPath) =>
			compileVueFile(
				resolve(dirname(sourceFilePath), relativeChildPath),
				outputDirs,
				cacheMap,
				false,
				vueRootDir
			)
		)
	);

	const compiledScript = compileScript(descriptor, {
		id: componentId,
		inlineTemplate: false
	});
	const strippedScript = stripExports(compiledScript.content);
	const transpiledScript = transpiler
		.transformSync(strippedScript)
		.replace(
			/(['"])(\.{1,2}\/[^'"]+)(['"])/g,
			(_, quoteStart, relativeImport, quoteEnd) =>
				`${quoteStart}${toJs(relativeImport)}${quoteEnd}`
		);

	const generateRenderFunction = (ssr: boolean) =>
		compileTemplate({
			compilerOptions: {
				bindingMetadata: compiledScript.bindings,
				prefixIdentifiers: true
			},
			filename: sourceFilePath,
			id: componentId,
			scoped: descriptor.styles.some((styleBlock) => styleBlock.scoped),
			source: descriptor.template?.content ?? '',
			ssr,
			ssrCssVars: descriptor.cssVars
		}).code.replace(
			/(['"])(\.{1,2}\/[^'"]+)(['"])/g,
			(_, quoteStart, relativeImport, quoteEnd) =>
				`${quoteStart}${toJs(relativeImport)}${quoteEnd}`
		);

	const localCss = descriptor.styles.map(
		(styleBlock) =>
			compileStyle({
				filename: sourceFilePath,
				id: componentId,
				scoped: styleBlock.scoped,
				source: styleBlock.content,
				trim: true
			}).code
	);
	const allCss = [
		...localCss,
		...childBuildResults.flatMap((result) => result.cssCodes)
	];

	let cssOutputPaths: string[] = [];
	if (isEntryPoint && allCss.length) {
		const cssOutputFile = join(
			outputDirs.css,
			`${toKebab(fileBaseName)}.css`
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
	const clientCode = assembleModule(
		generateRenderFunction(false),
		'render',
		true
	);
	const serverCode = assembleModule(
		generateRenderFunction(true),
		'ssrRender',
		false
	);

	const clientOutputPath = join(
		outputDirs.client,
		`${relativeWithoutExtension}.js`
	);
	const serverOutputPath = join(
		outputDirs.server,
		`${relativeWithoutExtension}.js`
	);

	await mkdir(dirname(clientOutputPath), { recursive: true });
	await mkdir(dirname(serverOutputPath), { recursive: true });
	await write(clientOutputPath, clientCode);
	await write(serverOutputPath, serverCode);

	const result: BuildResult = {
		clientPath: clientOutputPath,
		cssCodes: allCss,
		cssPaths: cssOutputPaths,
		serverPath: serverOutputPath,
		tsHelperPaths: [
			...helperModulePaths.map((helper) =>
				resolve(
					dirname(sourceFilePath),
					helper.endsWith('.ts') ? helper : `${helper}.ts`
				)
			),
			...childBuildResults.flatMap((child) => child.tsHelperPaths)
		],
		hmrId
	};

	cacheMap.set(sourceFilePath, result);

	return result;
};

export const compileVue = async (
	entryPoints: string[],
	vueRootDir: string,
	isDev = false
) => {
	const compiledOutputRoot = join(vueRootDir, 'compiled');
	const clientOutputDir = join(compiledOutputRoot, 'client');
	const indexOutputDir = join(compiledOutputRoot, 'indexes');
	const serverOutputDir = join(compiledOutputRoot, 'pages');
	const cssOutputDir = join(compiledOutputRoot, 'styles');

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
			const result = await compileVueFile(
				resolve(entryPath),
				{
					client: clientOutputDir,
					css: cssOutputDir,
					server: serverOutputDir
				},
				buildCache,
				true,
				vueRootDir
			);

			result.tsHelperPaths.forEach((path) => allTsHelperPaths.add(path));

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
					`import Comp from "${relative(dirname(indexOutputFile), clientOutputFile).replace(/\\/g, '/')}";`,
					'import { createSSRApp } from "vue";',
					'',
					'// HMR State Preservation: Check for preserved state from HMR',
					'let preservedState = (typeof window !== "undefined" && window.__HMR_PRESERVED_STATE__) ? window.__HMR_PRESERVED_STATE__ : {};',
					'',
					'// Fallback: check sessionStorage if window state is empty',
					'if (typeof window !== "undefined" && Object.keys(preservedState).length === 0) {',
					'  try {',
					'    const stored = sessionStorage.getItem("__VUE_HMR_STATE__");',
					'    if (stored) {',
					'      preservedState = JSON.parse(stored);',
					'      sessionStorage.removeItem("__VUE_HMR_STATE__");',
					'    }',
					'  } catch (e) {}',
					'}',
					'',
					'const mergedProps = { ...(window.__INITIAL_PROPS__ ?? {}), ...preservedState };',
					'',
					'// Use createSSRApp for proper hydration of server-rendered content',
					'const app = createSSRApp(Comp, mergedProps);',
					'app.mount("#root");',
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

	return {
		vueClientPaths: compiledPages.map((result) => result.clientPath),
		vueCssPaths: compiledPages.flatMap((result) => result.cssPaths),
		vueIndexPaths: compiledPages.map((result) => result.indexPath),
		vueServerPaths: compiledPages.map((result) => result.serverPath),
		// Export HMR metadata from vueHmrMetadata map (populated during compilation)
		hmrMetadata: new Map(vueHmrMetadata)
	};
};
