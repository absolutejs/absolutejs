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
		.filter((path): path is string => path !== undefined);

const toJs = (filePath: string) =>
	filePath.endsWith('.vue')
		? filePath.replace(/\.vue$/, '.js')
		: filePath.endsWith('.ts')
			? filePath.replace(/\.ts$/, '.js')
			: `${filePath}.js`;

const stripExports = (code: string) =>
	code
		.replace(/export\s+default/, 'const script =')
		.replace(/^export\s+/gm, '');

const mergeVueImports = (code: string) => {
	const lines = code.split('\n');
	const specifiers = new Set<string>();
	const importRegex = /^import\s+{([^}]+)}\s+from\s+['"]vue['"];?$/;

	lines.forEach((l) => {
		const m = l.match(importRegex);
		if (m?.[1]) m[1].split(',').forEach((s) => specifiers.add(s.trim()));
	});

	const filtered = lines.filter((l) => !importRegex.test(l));

	return specifiers.size
		? [
				`import { ${[...specifiers].join(', ')} } from "vue";`,
				...filtered
			].join('\n')
		: filtered.join('\n');
};

const compileVueFile = async (
	source: string,
	outputDirs: { client: string; server: string; css: string },
	cache: Map<string, BuildResult>,
	isEntry: boolean,
	vueRoot: string
): Promise<BuildResult> => {
	const cached = cache.get(source);
	if (cached) return cached;

	const relPath = relative(vueRoot, source).replace(/\\/g, '/');
	const relNoExt = relPath.replace(/\.vue$/, '');
	const name = basename(source, '.vue');
	const id = toKebab(name);

	const text = await file(source).text();
	const { descriptor } = parse(text, { filename: source });
	const setupContent =
		descriptor.scriptSetup?.content ?? descriptor.script?.content ?? '';

	const imports = extractImports(setupContent);
	const childPaths = imports.filter(
		(p) => p.startsWith('.') && p.endsWith('.vue')
	);
	const helperPaths = imports.filter(
		(p) => p.startsWith('.') && !p.endsWith('.vue')
	);

	const childResults: BuildResult[] = await Promise.all(
		childPaths.map((rel) =>
			compileVueFile(
				resolve(dirname(source), rel),
				outputDirs,
				cache,
				false,
				vueRoot
			)
		)
	);

	const scriptRes = compileScript(descriptor, { id, inlineTemplate: false });
	const tsScript = stripExports(scriptRes.content);
	const transpiled = transpiler
		.transformSync(tsScript)
		.replace(
			/(['"])(\.{1,2}\/[^'"]+)(['"])/g,
			(_, q, p, e) => `${q}${toJs(p)}${e}`
		);

	const renderFn = (ssr: boolean) =>
		compileTemplate({
			compilerOptions: {
				bindingMetadata: scriptRes.bindings,
				prefixIdentifiers: true
			},
			filename: source,
			id,
			scoped: descriptor.styles.some((s) => s.scoped),
			source: descriptor.template?.content ?? '',
			ssr,
			ssrCssVars: descriptor.cssVars
		}).code.replace(
			/(['"])(\.{1,2}\/[^'"]+)(['"])/g,
			(_, q, p, e) => `${q}${toJs(p)}${e}`
		);

	const cssOwn = descriptor.styles.map(
		(s) =>
			compileStyle({
				filename: source,
				id,
				scoped: s.scoped,
				source: s.content,
				trim: true
			}).code
	);
	const cssAll = [...cssOwn, ...childResults.flatMap((r) => r.cssCodes)];

	let cssFiles: string[] = [];
	if (isEntry && cssAll.length) {
		const cssOut = join(outputDirs.css, `${toKebab(name)}.css`);
		await mkdir(dirname(cssOut), { recursive: true });
		await write(cssOut, cssAll.join('\n'));
		cssFiles = [cssOut];
	}

	const assemble = (code: string, method: 'render' | 'ssrRender') =>
		mergeVueImports(
			[
				transpiled,
				code,
				`script.${method} = ${method};`,
				'export default script;'
			].join('\n')
		);

	const clientCode = assemble(renderFn(false), 'render');
	const serverCode = assemble(renderFn(true), 'ssrRender');

	const clientOut = join(outputDirs.client, `${relNoExt}.js`);
	const serverOut = join(outputDirs.server, `${relNoExt}.js`);
	await mkdir(dirname(clientOut), { recursive: true });
	await mkdir(dirname(serverOut), { recursive: true });
	await write(clientOut, clientCode);
	await write(serverOut, serverCode);

	const result: BuildResult = {
		clientPath: clientOut,
		cssCodes: cssAll,
		cssPaths: cssFiles,
		serverPath: serverOut,
		tsHelperPaths: [
			...helperPaths.map((h) =>
				resolve(dirname(source), h.endsWith('.ts') ? h : `${h}.ts`)
			),
			...childResults.flatMap((r) => r.tsHelperPaths)
		]
	};

	cache.set(source, result);

	return result;
};

export const compileVue = async (entryPoints: string[], vueRoot: string) => {
	const compiledRoot = join(vueRoot, 'compiled');
	const clientDir = join(compiledRoot, 'client');
	const indexDir = join(compiledRoot, 'indexes');
	const pagesDir = join(compiledRoot, 'pages');
	const stylesDir = join(compiledRoot, 'styles');

	await Promise.all([
		mkdir(clientDir, { recursive: true }),
		mkdir(indexDir, { recursive: true }),
		mkdir(pagesDir, { recursive: true }),
		mkdir(stylesDir, { recursive: true })
	]);

	const cache = new Map<string, BuildResult>();
	const tsHelpers = new Set<string>();

	const pageResults = await Promise.all(
		entryPoints.map(async (entry) => {
			const res = await compileVueFile(
				resolve(entry),
				{ client: clientDir, css: stylesDir, server: pagesDir },
				cache,
				true,
				vueRoot
			);
			res.tsHelperPaths.forEach((hp) => tsHelpers.add(hp));

			const name = basename(entry, '.vue');
			const indexOut = join(indexDir, `${name}.js`);
			const clientOut = join(
				clientDir,
				`${relative(vueRoot, entry)
					.replace(/\\/g, '/')
					.replace(/\.vue$/, '.js')}`
			);

			await mkdir(dirname(indexOut), { recursive: true });
			await write(
				indexOut,
				[
					`import Comp from "${relative(dirname(indexOut), clientOut)}";`,
					'import { createSSRApp } from "vue";',
					'const props = window.__INITIAL_PROPS__ ?? {};',
					'createSSRApp(Comp, props).mount("#root");'
				].join('\n')
			);

			return {
				cssPaths: res.cssPaths,
				indexPath: indexOut,
				serverPath: res.serverPath
			};
		})
	);

	await Promise.all(
		Array.from(tsHelpers).map(async (src) => {
			const text = await file(src).text();
			const js = transpiler.transformSync(text);
			const rel = relative(vueRoot, src).replace(/\.ts$/, '.js');
			const outClient = join(clientDir, rel);
			const outServer = join(pagesDir, rel);
			await mkdir(dirname(outClient), { recursive: true });
			await mkdir(dirname(outServer), { recursive: true });
			await write(outClient, js);
			await write(outServer, js);
		})
	);

	return {
		vueCssPaths: pageResults.flatMap((r) => r.cssPaths),
		vueIndexPaths: pageResults.map((r) => r.indexPath),
		vueServerPaths: pageResults.map((r) => r.serverPath)
	};
};
