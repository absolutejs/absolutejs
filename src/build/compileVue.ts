import { mkdir } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import {
	parse,
	compileScript,
	compileTemplate,
	compileStyle
} from '@vue/compiler-sfc';
import { file, write, Transpiler } from 'bun';
import { toKebab } from '../utils/stringModifiers';

const transpiler = new Transpiler({ loader: 'ts', target: 'browser' });

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
		renderFnName: 'render' | 'ssrRender'
	) =>
		mergeVueImports(
			[
				transpiledScript,
				renderCode,
				`script.${renderFnName} = ${renderFnName};`,
				'export default script;'
			].join('\n')
		);

	const clientCode = assembleModule(generateRenderFunction(false), 'render');
	const serverCode = assembleModule(
		generateRenderFunction(true),
		'ssrRender'
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
		]
	};

	cacheMap.set(sourceFilePath, result);

	return result;
};

export const compileVue = async (entryPoints: string[], vueRootDir: string) => {
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
			await write(
				indexOutputFile,
				[
					`import Comp from "${relative(dirname(indexOutputFile), clientOutputFile)}";`,
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
		vueCssPaths: compiledPages.flatMap((result) => result.cssPaths),
		vueIndexPaths: compiledPages.map((result) => result.indexPath),
		vueServerPaths: compiledPages.map((result) => result.serverPath)
	};
};
