/* The pure, per-SFC half of `compileVueFile` — everything from
 * `@vue/compiler-sfc` parse through to the final client/server
 * intermediates with their inline sourcemaps. It reads only its input
 * (plus the filesystem for `@import`ed CSS and imported prop types) and
 * writes nothing, so the build worker pool can run it on any thread;
 * `compileVue.ts` keeps the orchestration, caches and output writes on
 * the main thread. The inline (`ABSOLUTE_BUILD_WORKERS=0`) and pooled
 * paths execute this exact function, which is what makes their output
 * byte-for-byte identical. */

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { Transpiler } from 'bun';
import type {
	VueSfcCompileInput,
	VueSfcCompileOutput
} from '../../types/workerPool';
import { buildIslandMetadataExports } from '../islands/sourceMetadata';
import { loadVueCompiler } from '../utils/vueCompiler';
import { buildLineRemap, remapGeneratedLines } from './chainInlineSourcemaps';
import { isStylePath } from './stylePreprocessor';
import { hashContent } from './vueCompileCache';

const transpiler = new Transpiler({ loader: 'ts', target: 'browser' });

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

	const importRegex =
		/@import\s+(?:url\(\s*)?(['"])(\.{1,2}\/[^'"]+)\1\s*\)?\s*;?/g;

	return cssContent.replace(importRegex, (match, _quote, relPath) => {
		const importedPath = resolve(dirname(cssFilePath), relPath);
		if (!existsSync(importedPath)) return match;
		const importedContent = readFileSync(importedPath, 'utf-8');

		return inlineCssImports(importedContent, importedPath, visited);
	});
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

const wrapServerAsyncComponentLoader = (code: string) => {
	const vueImportRegex = /import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?/;
	const match = code.match(vueImportRegex);
	if (!match?.[1]) return code;

	const specifiers = match[1].split(',').map((specifier) => specifier.trim());
	const asyncComponentIndex = specifiers.findIndex((specifier) =>
		/^defineAsyncComponent(?:\s+as\s+[A-Za-z_$][\w$]*)?$/.test(specifier)
	);
	if (asyncComponentIndex === -1) return code;

	const asyncComponentSpecifier = specifiers[asyncComponentIndex] ?? '';
	const localName =
		asyncComponentSpecifier.match(/\s+as\s+([A-Za-z_$][\w$]*)$/)?.[1] ??
		'defineAsyncComponent';
	const importedName = '__absoluteDefineAsyncComponent';
	specifiers[asyncComponentIndex] = `defineAsyncComponent as ${importedName}`;

	const wrapper = `
const __absoluteResolveAsyncVueComponent = async (loader) => {
  const loaded = await loader();
  return loaded && typeof loaded === "object" && "default" in loaded
    ? loaded.default
    : loaded;
};
const ${localName} = (source) => ${importedName}(
  typeof source === "function"
    ? () => __absoluteResolveAsyncVueComponent(source)
    : { ...source, loader: () => __absoluteResolveAsyncVueComponent(source.loader) },
);`;

	return code.replace(
		vueImportRegex,
		`import { ${specifiers.join(', ')} } from 'vue';${wrapper}`
	);
};

const rewriteRelativeImports = (code: string, sourceDir: string) =>
	code.replace(
		/(['"])(\.{1,2}\/[^'"]+)(['"])/g,
		(_, quoteStart, relativeImport, quoteEnd) =>
			`${quoteStart}${toJs(relativeImport, sourceDir)}${quoteEnd}`
	);

export const compileVueSfc = async ({
	clientOutputPath,
	componentId,
	hmrId,
	packageImportRewrites,
	serverOutputPath,
	sourceContent,
	sourceFilePath,
	styleSources
}: VueSfcCompileInput) => {
	const compiler = await loadVueCompiler();
	const { descriptor } = compiler.parse(sourceContent, {
		filename: sourceFilePath
	});
	const islandMetadataExports = buildIslandMetadataExports(sourceContent);
	const hasScript = descriptor.script || descriptor.scriptSetup;
	const typeDepHashes: Record<string, string> = {};
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
					realpath: realpathSync,
					readFile: (file) => {
						if (!existsSync(file)) return undefined;
						const content = readFileSync(file, 'utf-8');
						// Anything read here shapes the output (imported
						// prop/emit types), so the cache re-verifies it.
						typeDepHashes[file] = hashContent(content);

						return content;
					}
				},
				id: componentId,
				inlineTemplate: false,
				sourceMap: true
			})
		: { bindings: {}, content: 'export default {};', map: undefined };
	// `deps` lists every file the script's imported types were resolved
	// from. Vue caches those scopes in-process, so the fs adapter above
	// only observes the first read — `deps` is the authoritative list.
	const typeDependencies =
		'deps' in compiledScript ? (compiledScript.deps ?? []) : [];
	for (const dep of typeDependencies) {
		if (dep in typeDepHashes || !existsSync(dep)) continue;
		typeDepHashes[dep] = hashContent(readFileSync(dep, 'utf-8'));
	}
	const strippedScript = stripExports(compiledScript.content);
	const sourceDir = dirname(sourceFilePath);
	const transpiledScript = rewriteRelativeImports(
		transpiler.transformSync(strippedScript),
		sourceDir
	);

	const generateRenderFunction = (ssr: boolean) => {
		const rendered = compiler.compileTemplate({
			compilerOptions: {
				bindingMetadata: compiledScript.bindings,
				expressionPlugins: ['typescript'],
				prefixIdentifiers: true,
				isCustomElement: (tag) => tag === 'absolute-island'
			},
			filename: sourceFilePath,
			id: componentId,
			scoped: descriptor.styles.some((styleBlock) => styleBlock.scoped),
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
		return rewriteRelativeImports(
			transpiler.transformSync(rendered),
			sourceDir
		);
	};

	const localCss = descriptor.styles.map(
		(styleBlock, index) =>
			compiler.compileStyle({
				filename: sourceFilePath,
				id: componentId,
				scoped: styleBlock.scoped,
				source: inlineCssImports(
					styleSources[index] ?? styleBlock.content,
					sourceFilePath
				),
				trim: true
			}).code
	);

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
		wrapServerAsyncComponentLoader(
			assembleModule(generateRenderFunction(true), 'ssrRender', false)
		) + islandMetadataExports;

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
		const map: NonNullable<typeof compiledScript.map> = {
			...compiledScript.map,
			mappings
		};

		return `\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(
			JSON.stringify(map)
		).toString('base64')}\n`;
	};

	const output: VueSfcCompileOutput = {
		clientOutput: clientFinal + inlineSourceMapFor(clientFinal),
		localCss,
		serverOutput: serverFinal + inlineSourceMapFor(serverFinal),
		typeDepHashes
	};

	return output;
};
