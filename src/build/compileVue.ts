import { mkdir } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { cwd } from 'node:process';
import {
	parse,
	compileScript,
	compileTemplate,
	compileStyle
} from '@vue/compiler-sfc';
import { file, write, Transpiler } from 'bun';
import { toKebab } from '../utils/stringModifiers';

const transpiler = new Transpiler({ loader: 'ts', target: 'browser' });
const projectRoot = cwd();

type BuildResult = {
	clientPath: string;
	serverPath: string;
	cssPaths: string[];
	cssCodes: string[];
	tsHelperPaths: string[];
};

const extractImports = (sourceCode: string) =>
	Array.from(sourceCode.matchAll(/import\s+[\s\S]+?['"]([^'"]+)['"]/g))
		.map((matchResult) => matchResult[1])
		.filter((importPath): importPath is string => importPath !== undefined);

const toJs = (filePath: string) => {
	if (filePath.endsWith('.vue')) {
		return filePath.replace(/\.vue$/, '.js');
	}

	if (filePath.endsWith('.ts')) {
		return filePath.replace(/\.ts$/, '.js');
	}

	return `${filePath}.js`;
};

const stripExports = (moduleCode: string) =>
	moduleCode
		.replace(/export\s+default/, 'const script =')
		.replace(/^export\s+/gm, '');

const mergeVueImports = (compiledCode: string) => {
	const fileLines = compiledCode.split('\n');
	const vueSpecifiers = new Set<string>();

	const importRE = /^import\s+{([^}]+)}\s+from\s+["']vue["'];?$/;

	fileLines.forEach((line) => {
		const match = line.match(importRE);
		if (!match || !match[1]) return;
		match[1].split(',').forEach((spec) => vueSpecifiers.add(spec.trim()));
	});

	const filteredLines = fileLines.filter((line) => !importRE.test(line));
	if (!vueSpecifiers.size) return filteredLines.join('\n');

	const mergedImport = `import { ${[...vueSpecifiers].join(', ')} } from "vue";`;

	return [mergedImport, ...filteredLines].join('\n');
};

const compileVueFile = async (
	sourceAbsolutePath: string,
	outputDirs: { client: string; server: string; css: string },
	cache: Map<string, BuildResult>,
	isEntry = false
) => {
	const cachedResult = cache.get(sourceAbsolutePath);
	if (cachedResult) return cachedResult;

	const relativePath = relative(projectRoot, sourceAbsolutePath).replace(
		/\\/g,
		'/'
	);
	const relativeWithoutExt = relativePath.replace(/\.vue$/, '');
	const componentName = basename(sourceAbsolutePath, '.vue');
	const componentId = toKebab(componentName);

	const sourceContent = await file(sourceAbsolutePath).text();
	const { descriptor } = parse(sourceContent, {
		filename: sourceAbsolutePath
	});
	const setupContent =
		descriptor.scriptSetup?.content ?? descriptor.script?.content ?? '';

	const importPaths = extractImports(setupContent);
	const childComponents = importPaths.filter(
		(path) => path.startsWith('.') && path.endsWith('.vue')
	);
	const tsHelperImports = importPaths.filter(
		(path) => path.startsWith('.') && !path.endsWith('.vue')
	);

	const childBuildResults = await Promise.all(
		childComponents.map((importPath) =>
			compileVueFile(
				resolve(dirname(sourceAbsolutePath), importPath),
				outputDirs,
				cache,
				false
			)
		)
	);

	const compiledScript = compileScript(descriptor, {
		id: componentId,
		inlineTemplate: false
	});
	const transpiledScript = transpiler
		.transformSync(stripExports(compiledScript.content))
		.replace(
			/(['"])(\.{1,2}\/[^'"]+)(['"])/g,
			(fullMatch, quote, originalPath, endQuote) =>
				`${quote}${toJs(originalPath)}${endQuote}`
		);

	const renderFactory = (isSsr: boolean) =>
		compileTemplate({
			compilerOptions: {
				bindingMetadata: compiledScript.bindings,
				prefixIdentifiers: true
			},
			filename: sourceAbsolutePath,
			id: componentId,
			scoped: descriptor.styles.some((style) => style.scoped),
			source: descriptor.template?.content ?? '',
			ssr: isSsr,
			ssrCssVars: descriptor.cssVars
		}).code.replace(
			/(['"])(\.{1,2}\/[^'"]+)(['"])/g,
			(fullMatch, quote, originalPath, endQuote) =>
				`${quote}${toJs(originalPath)}${endQuote}`
		);

	const ownCssCodes = descriptor.styles.map(
		(styleBlock) =>
			compileStyle({
				filename: sourceAbsolutePath,
				id: componentId,
				scoped: styleBlock.scoped,
				source: styleBlock.content,
				trim: true
			}).code
	);
	const allCssCodes = [
		...ownCssCodes,
		...childBuildResults.flatMap((res) => res.cssCodes)
	];

	let outputCssPaths: string[] = [];
	if (isEntry && allCssCodes.length) {
		const cssOutputFile = join(
			outputDirs.css,
			`${toKebab(componentName)}.css`
		);
		await mkdir(dirname(cssOutputFile), { recursive: true });
		await write(cssOutputFile, allCssCodes.join('\n'));
		outputCssPaths = [cssOutputFile];
	}

	const assembleModule = (
		renderCode: string,
		renderMethod: 'render' | 'ssrRender'
	) =>
		mergeVueImports(
			[
				transpiledScript,
				renderCode,
				`script.${renderMethod} = ${renderMethod};`,
				'export default script;'
			].join('\n')
		);

	const clientModuleCode = assembleModule(renderFactory(false), 'render');
	const serverModuleCode = assembleModule(renderFactory(true), 'ssrRender');

	const clientOutputFile = join(
		outputDirs.client,
		`${relativeWithoutExt}.js`
	);
	const serverOutputFile = join(
		outputDirs.server,
		`${relativeWithoutExt}.js`
	);
	await mkdir(dirname(clientOutputFile), { recursive: true });
	await mkdir(dirname(serverOutputFile), { recursive: true });
	await write(clientOutputFile, clientModuleCode);
	await write(serverOutputFile, serverModuleCode);

	const buildResult: BuildResult = {
		clientPath: clientOutputFile,
		cssCodes: allCssCodes,
		cssPaths: outputCssPaths,
		serverPath: serverOutputFile,
		tsHelperPaths: [
			...tsHelperImports.map((helper) =>
				resolve(
					dirname(sourceAbsolutePath),
					helper.endsWith('.ts') ? helper : `${helper}.ts`
				)
			),
			...childBuildResults.flatMap((res) => res.tsHelperPaths)
		]
	};

	cache.set(sourceAbsolutePath, buildResult);

	return buildResult;
};

export const compileVue = async (entryPoints: string[], outRoot: string) => {
	const clientDir = join(outRoot, 'client');
	const indexDir = join(outRoot, 'indexes');
	const pagesDir = join(outRoot, 'pages');
	const stylesDir = join(outRoot, 'styles');

	await Promise.all([
		mkdir(clientDir, { recursive: true }),
		mkdir(indexDir, { recursive: true }),
		mkdir(pagesDir, { recursive: true }),
		mkdir(stylesDir, { recursive: true })
	]);

	const cache = new Map<string, BuildResult>();
	const tsHelpersSet = new Set<string>();

	const pageResults = await Promise.all(
		entryPoints.map(async (entryPoint) => {
			const result = await compileVueFile(
				resolve(entryPoint),
				{ client: clientDir, css: stylesDir, server: pagesDir },
				cache,
				true
			);

			result.tsHelperPaths.forEach((helperPath) =>
				tsHelpersSet.add(helperPath)
			);

			const entryRelative = relative(projectRoot, entryPoint).replace(
				/\.vue$/,
				''
			);
			const indexOutputFile = join(indexDir, `${entryRelative}.js`);
			const clientEntryFile = join(clientDir, `${entryRelative}.js`);

			await mkdir(dirname(indexOutputFile), { recursive: true });
			await write(
				indexOutputFile,
				[
					`import Comp from "${relative(dirname(indexOutputFile), clientEntryFile)}";`,
					'import { createSSRApp } from "vue";',
					'const props = window.__INITIAL_PROPS__ ?? {};',
					'createSSRApp(Comp, props).mount("#root");'
				].join('\n')
			);

			return {
				cssPaths: result.cssPaths,
				indexPath: indexOutputFile,
				serverPath: result.serverPath
			};
		})
	);

	await Promise.all(
		Array.from(tsHelpersSet).map(async (helperSource) => {
			const code = await file(helperSource).text();
			const transpiled = transpiler.transformSync(code);
			const helperRelativePath = relative(
				projectRoot,
				helperSource
			).replace(/\.ts$/, '.js');
			const clientHelperDest = join(clientDir, helperRelativePath);
			const serverHelperDest = join(pagesDir, helperRelativePath);

			await Promise.all([
				mkdir(dirname(clientHelperDest), { recursive: true }),
				mkdir(dirname(serverHelperDest), { recursive: true })
			]);

			await Promise.all([
				write(clientHelperDest, transpiled),
				write(serverHelperDest, transpiled)
			]);
		})
	);

	return {
		vueCssPaths: pageResults.flatMap((artifact) => artifact.cssPaths),
		vueIndexPaths: pageResults.map((artifact) => artifact.indexPath),
		vueServerPaths: pageResults.map((artifact) => artifact.serverPath)
	};
};
