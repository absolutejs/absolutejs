import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { Transpiler } from 'bun';
import { BASE_36_RADIX } from '../constants';

const ISLAND_COMPONENT_ID_LENGTH = 8;

const serverCacheRoot = join(process.cwd(), '.absolutejs', 'islands', 'vue');

const compiledModuleCache = new Map<string, string>();

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

	return join(serverCacheRoot, `${normalizedSourcePath}.server.js`);
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
	const cachedModulePath = compiledModuleCache.get(sourcePath);
	if (cachedModulePath) return cachedModulePath;

	const compiler = await import('@vue/compiler-sfc');
	const source = await Bun.file(sourcePath).text();
	const { descriptor } = compiler.parse(source, { filename: sourcePath });
	const componentId = Bun.hash(sourcePath)
		.toString(BASE_36_RADIX)
		.slice(0, ISLAND_COMPONENT_ID_LENGTH);

	const hasScript = descriptor.script || descriptor.scriptSetup;
	const compiledScript = hasScript
		? compiler.compileScript(descriptor, {
				fs: {
					fileExists: existsSync,
					realpath: realpathSync,
					readFile: (file) =>
						existsSync(file)
							? readFileSync(file, 'utf-8')
							: undefined
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
