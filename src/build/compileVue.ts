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
		.map((match) => match[1])
		.filter((importPath): importPath is string => importPath !== undefined);

const toJsFileName = (path: string) => {
	if (path.endsWith('.vue')) {
		return path.replace(/\.vue$/, '.js');
	}
	if (path.endsWith('.ts')) {
		return path.replace(/\.ts$/, '.js');
	}

	return `${path}.js`;
};

const stripModuleExports = (sourceCode: string) =>
	sourceCode
		.replace(/export\s+default/, 'const script =')
		.replace(/^export\s+/gm, '');

const buildVueFile = async (
	absolutePath: string,
	outputDirs: { client: string; server: string; css: string },
	cache: Map<string, BuildResult>,
	isEntryPage = false
) => {
	if (cache.has(absolutePath)) return cache.get(absolutePath)!;

	const relativePath = relative(projectRoot, absolutePath).replace(
		/\\/g,
		'/'
	);
	const relativePathWithoutExt = relativePath.replace(/\.vue$/, '');
	const componentName = basename(absolutePath, '.vue');
	const kebabId = toKebab(componentName);

	const sourceCode = await file(absolutePath).text();
	const { descriptor } = parse(sourceCode, { filename: absolutePath });
	const originalSetupCode =
		descriptor.scriptSetup?.content ?? descriptor.script?.content ?? '';

	const relativeImports = extractImports(originalSetupCode);
	const childVueImports = relativeImports.filter(
		(importPath): importPath is string =>
			importPath.startsWith('.') && importPath.endsWith('.vue')
	);
	const tsHelperImports = relativeImports.filter(
		(importPath): importPath is string =>
			importPath.startsWith('.') && !importPath.endsWith('.vue')
	);

	const childBuildResults = await Promise.all(
		childVueImports.map((importPath) =>
			buildVueFile(
				resolve(dirname(absolutePath), importPath),
				outputDirs,
				cache,
				false
			)
		)
	);

	const compiledScript = compileScript(descriptor, {
		id: kebabId,
		inlineTemplate: false
	});

	const transformedScript = transpiler
		.transformSync(stripModuleExports(compiledScript.content))
		.replace(
			/(['"])(\.{1,2}\/[^'"]+)(['"])/g,
			(_, quote, importPath, endQuote) =>
				quote + toJsFileName(importPath) + endQuote
		);

	const renderBlock = (forServer: boolean) =>
		compileTemplate({
			compilerOptions: {
				bindingMetadata: compiledScript.bindings,
				prefixIdentifiers: true
			},
			filename: absolutePath,
			id: kebabId,
			scoped: descriptor.styles.some((s) => s.scoped),
			source: descriptor.template?.content ?? '',
			ssr: forServer,
			ssrCssVars: descriptor.cssVars
		}).code.replace(
			/(['"])(\.{1,2}\/[^'"]+)(['"])/g,
			(_, quote, importPath, endQuote) =>
				quote + toJsFileName(importPath) + endQuote
		);

	const ownCssCodes = descriptor.styles.map(
		(styleBlock) =>
			compileStyle({
				filename: absolutePath,
				id: kebabId,
				scoped: styleBlock.scoped,
				source: styleBlock.content,
				trim: true
			}).code
	);

	const aggregatedCssCodes = [
		...ownCssCodes,
		...childBuildResults.flatMap((result) => result.cssCodes)
	];

	let emittedCssPaths: string[] = [];
	if (isEntryPage && aggregatedCssCodes.length) {
		const cssOutputPath = join(
			outputDirs.css,
			`${toKebab(componentName)}.css`
		);
		await mkdir(dirname(cssOutputPath), { recursive: true });
		await write(cssOutputPath, aggregatedCssCodes.join('\n'));
		emittedCssPaths = [cssOutputPath];
	}

	const buildModule = (
		renderCode: string,
		renderFunctionName: 'render' | 'ssrRender'
	) => {
		const vueHeader = 'import { defineComponent } from "vue";';

		return [
			transformedScript,
			renderCode,
			vueHeader,
			`export default defineComponent({ ...script, ${renderFunctionName} });`
		].join('\n');
	};

	const clientModuleCode = buildModule(renderBlock(false), 'render');
	const serverModuleCode = buildModule(renderBlock(true), 'ssrRender');

	const clientOutPath = join(
		outputDirs.client,
		`${relativePathWithoutExt}.js`
	);
	const serverOutPath = join(
		outputDirs.server,
		`${relativePathWithoutExt}.js`
	);
	await mkdir(dirname(clientOutPath), { recursive: true });
	await mkdir(dirname(serverOutPath), { recursive: true });
	await write(clientOutPath, clientModuleCode);
	await write(serverOutPath, serverModuleCode);

	const buildResult: BuildResult = {
		clientPath: clientOutPath,
		cssCodes: aggregatedCssCodes,
		cssPaths: emittedCssPaths,
		serverPath: serverOutPath,
		tsHelperPaths: [
			...tsHelperImports.map((helper) =>
				resolve(
					dirname(absolutePath),
					helper.endsWith('.ts') ? helper : `${helper}.ts`
				)
			),
			...childBuildResults.flatMap((result) => result.tsHelperPaths)
		]
	};
	cache.set(absolutePath, buildResult);

	return buildResult;
};

export const compileVue = async (
	pageEntryPoints: string[],
	outputDirectory: string
) => {
	const clientDir = join(outputDirectory, 'client');
	const indexDir = join(outputDirectory, 'indexes');
	const pagesDir = join(outputDirectory, 'pages');
	const stylesDir = join(outputDirectory, 'styles');

	await Promise.all([
		mkdir(clientDir, { recursive: true }),
		mkdir(indexDir, { recursive: true }),
		mkdir(pagesDir, { recursive: true }),
		mkdir(stylesDir, { recursive: true })
	]);

	const buildCache = new Map<string, BuildResult>();
	const tsHelperSet = new Set<string>();

	const pageResults = await Promise.all(
		pageEntryPoints.map(async (pageEntry) => {
			const buildResult = await buildVueFile(
				resolve(pageEntry),
				{ client: clientDir, css: stylesDir, server: pagesDir },
				buildCache,
				true
			);

			buildResult.tsHelperPaths.forEach((p) => tsHelperSet.add(p));

			const relPath = relative(projectRoot, pageEntry).replace(
				/\.vue$/,
				''
			);
			const indexPath = join(indexDir, `${relPath}.js`);
			const clientEntryPath = join(clientDir, `${relPath}.js`);

			await mkdir(dirname(indexPath), { recursive: true });
			await write(
				indexPath,
				[
					`import Comp from "${relative(dirname(indexPath), clientEntryPath)}";`,
					'import { createSSRApp } from "vue";',
					'const props = window.__INITIAL_PROPS__ ?? {};',
					'createSSRApp(Comp, props).mount("#root");'
				].join('\n')
			);

			return {
				cssPaths: buildResult.cssPaths,
				indexPath,
				serverPath: buildResult.serverPath
			};
		})
	);

	await Promise.all(
		Array.from(tsHelperSet).map(async (src) => {
			const code = transpiler.transformSync(await file(src).text());
			const rel = relative(projectRoot, src).replace(/\.ts$/, '.js');
			const clientDest = join(clientDir, rel);
			const serverDest = join(pagesDir, rel);

			await Promise.all([
				mkdir(dirname(clientDest), { recursive: true }),
				mkdir(dirname(serverDest), { recursive: true })
			]);

			await Promise.all([
				write(clientDest, code),
				write(serverDest, code)
			]);
		})
	);

	return {
		vueCssPaths: pageResults.flatMap((pageResult) => pageResult.cssPaths),
		vueIndexPaths: pageResults.map((pageResult) => pageResult.indexPath),
		vueServerPaths: pageResults.map((pageResult) => pageResult.serverPath)
	};
};
