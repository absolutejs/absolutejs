import { rm, mkdir, cp } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { cwd, env, exit } from 'node:process';
import { $, build as bunBuild, BuildArtifact } from 'bun';
import { compileAngular } from '../build/compileAngular';
import { compileSvelte } from '../build/compileSvelte';
import { compileVue } from '../build/compileVue';
import { generateManifest } from '../build/generateManifest';
import { generateReactIndexFiles } from '../build/generateReactIndexes';
import { outputLogs } from '../build/outputLogs';
import { scanEntryPoints } from '../build/scanEntryPoints';
import { updateAssetPaths } from '../build/updateAssetPaths';
import { BuildConfig } from '../types';
import { cleanup } from '../utils/cleanup';
import { commonAncestor } from '../utils/commonAncestor';
import { getDurationString } from '../utils/getDurationString';
import { validateSafePath } from '../utils/validateSafePath';

const isDev = env.NODE_ENV === 'development';

const vueFeatureFlags: Record<string, string> = {
	__VUE_OPTIONS_API__: 'true',
	__VUE_PROD_DEVTOOLS__: isDev ? 'true' : 'false',
	__VUE_PROD_HYDRATION_MISMATCH_DETAILS__: isDev ? 'true' : 'false'
};

export const build = async ({
	buildDirectory = 'build',
	assetsDirectory = 'assets',
	reactDirectory,
	htmlDirectory,
	htmxDirectory,
	angularDirectory,
	svelteDirectory,
	vueDirectory,
	tailwind,
	options
}: BuildConfig) => {
	const buildStart = performance.now();
	const projectRoot = cwd();

	const buildPath = validateSafePath(buildDirectory, projectRoot);
	const assetsPath =
		assetsDirectory && validateSafePath(assetsDirectory, projectRoot);
	const reactDir =
		reactDirectory && validateSafePath(reactDirectory, projectRoot);
	const htmlDir =
		htmlDirectory && validateSafePath(htmlDirectory, projectRoot);
	const htmxDir =
		htmxDirectory && validateSafePath(htmxDirectory, projectRoot);
	const svelteDir =
		svelteDirectory && validateSafePath(svelteDirectory, projectRoot);
	const vueDir = vueDirectory && validateSafePath(vueDirectory, projectRoot);
	const angularDir =
		angularDirectory && validateSafePath(angularDirectory, projectRoot);

	const reactIndexesPath = reactDir && join(reactDir, 'indexes');
	const reactPagesPath = reactDir && join(reactDir, 'pages');
	const htmlPagesPath = htmlDir && join(htmlDir, 'pages');
	const htmlScriptsPath = htmlDir && join(htmlDir, 'scripts');
	const sveltePagesPath = svelteDir && join(svelteDir, 'pages');
	const vuePagesPath = vueDir && join(vueDir, 'pages');
	const htmxPagesPath = htmxDir && join(htmxDir, 'pages');
	const angularPagesPath = angularDir && join(angularDir, 'pages');

	const frontends = [
		reactDir,
		htmlDir,
		htmxDir,
		svelteDir,
		vueDir,
		angularDir
	].filter(Boolean);
	const isSingle = frontends.length === 1;

	let serverOutDir;
	if (svelteDir) serverOutDir = join(buildPath, basename(svelteDir), 'pages');
	else if (vueDir) serverOutDir = join(buildPath, basename(vueDir), 'pages');

	let serverRoot;
	if (sveltePagesPath) serverRoot = sveltePagesPath;
	else if (vuePagesPath) serverRoot = vuePagesPath;

	await rm(buildPath, { force: true, recursive: true });
	await mkdir(buildPath);

	if (reactIndexesPath && reactPagesPath)
		await generateReactIndexFiles(reactPagesPath, reactIndexesPath);

	if (assetsPath)
		await cp(assetsPath, join(buildPath, 'assets'), {
			force: true,
			recursive: true
		});

	if (tailwind)
		await $`bunx @tailwindcss/cli -i ${tailwind.input} -o ${join(buildPath, tailwind.output)}`;

	const reactEntries = reactIndexesPath
		? await scanEntryPoints(reactIndexesPath, '*.tsx')
		: [];
	const htmlEntries = htmlScriptsPath
		? await scanEntryPoints(htmlScriptsPath, '*.{js,ts}')
		: [];
	const svelteEntries = sveltePagesPath
		? await scanEntryPoints(sveltePagesPath, '*.svelte')
		: [];
	const vueEntries = vuePagesPath
		? await scanEntryPoints(vuePagesPath, '*.vue')
		: [];
	const angularEntries = angularPagesPath
		? await scanEntryPoints(angularPagesPath, '*.ts')
		: [];

	const htmlCssEntries = htmlDir
		? await scanEntryPoints(join(htmlDir, 'styles'), '*.css')
		: [];
	const htmxCssEntries = htmxDir
		? await scanEntryPoints(join(htmxDir, 'styles'), '*.css')
		: [];
	const reactCssEntries = reactDir
		? await scanEntryPoints(join(reactDir, 'styles'), '*.css')
		: [];
	const svelteCssEntries = svelteDir
		? await scanEntryPoints(join(svelteDir, 'styles'), '*.css')
		: [];

	const { svelteServerPaths, svelteClientPaths } = svelteDir
		? await compileSvelte(svelteEntries, svelteDir)
		: { svelteClientPaths: [], svelteServerPaths: [] };

	const { vueServerPaths, vueIndexPaths, vueCssPaths } = vueDir
		? await compileVue(vueEntries, vueDir)
		: { vueCssPaths: [], vueIndexPaths: [], vueServerPaths: [] };

	const { serverPaths: angularServerPaths, clientPaths: angularClientPaths } =
		angularDir
			? await compileAngular(angularEntries, angularDir)
			: { clientPaths: [], serverPaths: [] };

	const serverEntryPoints = [
		...svelteServerPaths,
		...vueServerPaths,
		...angularServerPaths
	];
	const clientEntryPoints = [
		...reactEntries,
		...svelteClientPaths,
		...htmlEntries,
		...vueIndexPaths,
		...angularClientPaths
	];
	const cssEntryPoints = [
		...vueCssPaths,
		...reactCssEntries,
		...svelteCssEntries,
		...htmlCssEntries,
		...htmxCssEntries
	];

	if (serverEntryPoints.length === 0 && clientEntryPoints.length === 0) {
		console.warn('No entry points found, manifest will be empty.');

		return {};
	}

	let serverLogs: (BuildMessage | ResolveMessage)[] = [];
	let serverOutputs: BuildArtifact[] = [];

	if (serverEntryPoints.length > 0) {
		const { logs, outputs } = await bunBuild({
			entrypoints: serverEntryPoints,
			format: 'esm',
			naming: `[dir]/[name].[hash].[ext]`,
			outdir: serverOutDir,
			root: serverRoot,
			target: 'bun'
		}).catch((err) => {
			console.error('Server build failed:', err);
			exit(1);
		});
		serverLogs = logs;
		serverOutputs = outputs;
	}

	let clientLogs: (BuildMessage | ResolveMessage)[] = [];
	let clientOutputs: BuildArtifact[] = [];

	if (clientEntryPoints.length > 0) {
		const roots: string[] = [
			reactDir,
			svelteDir,
			htmlDir,
			vueDir,
			angularDir
		].filter((dir): dir is string => Boolean(dir));
		const clientRoot = isSingle
			? (roots[0] ?? projectRoot)
			: commonAncestor(roots, projectRoot);
		const { logs, outputs } = await bunBuild({
			define: vueDirectory ? vueFeatureFlags : undefined,
			entrypoints: clientEntryPoints,
			format: 'esm',
			minify: true,
			naming: `[dir]/[name].[hash].[ext]`,
			outdir: buildPath,
			root: clientRoot,
			target: 'browser'
		}).catch((err) => {
			console.error('Client build failed:', err);
			exit(1);
		});
		clientLogs = logs;
		clientOutputs = outputs;
	}

	let cssLogs: (BuildMessage | ResolveMessage)[] = [];
	let cssOutputs: BuildArtifact[] = [];

	if (cssEntryPoints.length > 0) {
		const { logs, outputs } = await bunBuild({
			entrypoints: cssEntryPoints,
			naming: `[name].[hash].[ext]`,
			outdir: join(buildPath, basename(assetsPath), 'css'),
			target: 'browser'
		}).catch((err) => {
			console.error('CSS build failed:', err);
			exit(1);
		});
		cssLogs = logs;
		cssOutputs = outputs;
	}

	const allLogs = [...serverLogs, ...clientLogs, ...cssLogs];
	outputLogs(allLogs);

	const manifest = generateManifest(
		[...serverOutputs, ...clientOutputs, ...cssOutputs],
		buildPath
	);

	if (htmlDir && htmlPagesPath) {
		const outputHtmlPages = join(buildPath, basename(htmlDir), 'pages');
		await mkdir(outputHtmlPages, { recursive: true });
		await cp(htmlPagesPath, outputHtmlPages, {
			force: true,
			recursive: true
		});
		await updateAssetPaths(manifest, outputHtmlPages);
	}

	if (htmxDir && htmxPagesPath) {
		const outputHtmxPages = join(buildPath, basename(htmxDir), 'pages');
		await mkdir(outputHtmxPages, { recursive: true });
		await cp(htmxPagesPath, outputHtmxPages, {
			force: true,
			recursive: true
		});
		await updateAssetPaths(manifest, outputHtmxPages);
	}

	if (!options?.preserveIntermediateFiles)
		await cleanup({
			reactIndexesPath,
			svelteDir,
			vueDir
		});

	console.log(
		`Build completed in ${getDurationString(performance.now() - buildStart)}`
	);

	return manifest;
};
