import { readFileSync, realpathSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { Transpiler } from 'bun';
import { isFile } from '../utils/isFile';
import { loadVueCompiler } from '../utils/vueCompiler';
import { toKebab } from '../utils/stringModifiers';
import { createIslandGenerationGuard } from './islandServerGeneration';

const serverCacheRoot = join(process.cwd(), '.absolutejs', 'islands', 'vue');

const compiledModuleCache = new Map<string, string>();
// Dev: an island edit moves the generation; compile again into new files
// so Bun imports the edit instead of its cached module.
const syncIslandGeneration = createIslandGenerationGuard(() => {
	compiledModuleCache.clear();
});

const transpiler = new Transpiler({ loader: 'ts', target: 'browser' });

const ensureRelativeImportPath = (from: string, target: string) => {
	const importPath = relative(dirname(from), target).replace(/\\/g, '/');

	return importPath.startsWith('.') ? importPath : `./${importPath}`;
};

const getCachedModulePath = (sourcePath: string) => {
	const relativeSourcePath = relative(process.cwd(), sourcePath).replace(
		/\\/g,
		'/'
	);
	const normalizedSourcePath = relativeSourcePath.startsWith('..')
		? sourcePath.replace(/[:\\/]/g, '_')
		: relativeSourcePath;

	const generation = syncIslandGeneration();
	const generationSuffix = generation > 0 ? `.g${generation}` : '';

	return join(
		serverCacheRoot,
		`${normalizedSourcePath}${generationSuffix}.server.js`
	);
};

const writeIfChanged = async (path: string, content: string) => {
	const targetFile = Bun.file(path);
	if (await targetFile.exists()) {
		const currentContent = await targetFile.text();
		if (currentContent === content) return;
	}

	await Bun.write(path, content);
};

const stripExports = (code: string) =>
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

const extractRelativeVueImports = (sourceCode: string) =>
	Array.from(sourceCode.matchAll(/import\s+[\s\S]+?['"]([^'"]+)['"]/g))
		.map((match) => match[1])
		.filter(
			(importPath): importPath is string =>
				typeof importPath === 'string' &&
				importPath.startsWith('.') &&
				importPath.endsWith('.vue')
		);

/* Compile a `.vue` SFC source file into a JS module suitable for a
   server-side `await import(...)`. Mirrors `compileSvelteServerModule`:
   the build-time pipeline already emits compiled SFCs to `build/...`,
   but the runtime SSR resolver may be handed a build reference that
   points back to the original `.vue` source (Vue island registry
   entries use the source path as their build reference). Bun has no
   runtime `.vue` loader, so this helper produces a cached JS file the
   resolver can dynamically import. */
export const compileVueServerModule = async (sourcePath: string) => {
	syncIslandGeneration();
	const cachedModulePath = compiledModuleCache.get(sourcePath);
	if (cachedModulePath) return cachedModulePath;

	const compiler = await loadVueCompiler();
	const source = await Bun.file(sourcePath).text();
	const { descriptor } = compiler.parse(source, { filename: sourcePath });
	// The id the client build gives the component (compileVue.ts): scoped
	// styles select `data-v-<id>`, so the server render must stamp the same
	// attribute or the island's shipped stylesheet never matches it.
	const componentId = toKebab(basename(sourcePath, '.vue'));

	const hasScript = descriptor.script || descriptor.scriptSetup;
	const compiledScript = hasScript
		? compiler.compileScript(descriptor, {
				fs: {
					fileExists: isFile,
					realpath: realpathSync,
					readFile: (file) =>
						isFile(file) ? readFileSync(file, 'utf-8') : undefined
				},
				id: componentId,
				inlineTemplate: false
			})
		: { bindings: {}, content: 'export default {};' };

	const renderCode = descriptor.template
		? compiler.compileTemplate({
				compilerOptions: {
					bindingMetadata: compiledScript.bindings,
					expressionPlugins: ['typescript'],
					prefixIdentifiers: true,
					isCustomElement: (tag) => tag === 'absolute-island'
				},
				filename: sourcePath,
				id: componentId,
				scoped: descriptor.styles.some(
					(styleBlock) => styleBlock.scoped
				),
				source: descriptor.template.content,
				ssr: true,
				ssrCssVars: descriptor.cssVars
			}).code
		: 'const ssrRender = () => {};';

	const childImportPaths = extractRelativeVueImports(compiledScript.content);
	const compiledChildren = await Promise.all(
		childImportPaths.map(async (relativeImport) => ({
			compiledPath: await compileVueServerModule(
				resolve(dirname(sourcePath), relativeImport)
			),
			spec: relativeImport
		}))
	);

	const strippedScript = stripExports(compiledScript.content);
	const transpiledScript = transpiler.transformSync(strippedScript);

	const assembled = mergeVueImports(
		[
			transpiledScript,
			renderCode,
			'script.ssrRender = ssrRender;',
			'export default script;'
		].join('\n')
	);

	const compiledModulePath = getCachedModulePath(sourcePath);
	let rewritten = assembled;
	for (const child of compiledChildren) {
		rewritten = rewritten.replaceAll(
			child.spec,
			ensureRelativeImportPath(compiledModulePath, child.compiledPath)
		);
	}

	await mkdir(dirname(compiledModulePath), { recursive: true });
	await writeIfChanged(compiledModulePath, rewritten);
	compiledModuleCache.set(sourcePath, compiledModulePath);

	return compiledModulePath;
};
