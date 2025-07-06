import { rm, mkdir, cp } from 'node:fs/promises';
import { basename, join, sep } from 'node:path';
import { cwd, env, exit } from 'node:process';
import { $, build as bunBuild, BuildArtifact } from 'bun';
import { compileSvelte } from '../build/compileSvelte';
import { compileVue } from '../build/compileVue';
import { generateManifest } from '../build/generateManifest';
import { generateReactIndexFiles } from '../build/generateReactIndexes';
import { scanEntryPoints } from '../build/scanEntryPoints';
import { updateAssetPaths } from '../build/updateAssetPaths';
import { BuildConfig } from '../types';
import { getDurationString } from '../utils/getDurationString';
import { validateSafePath } from '../utils/validateSafePath';

const commonAncestor = (paths: string[], fallback: string) => {
	if (paths.length === 0) return fallback;
	const segmentsList = paths.map((p) => p.split(sep));
	const [first] = segmentsList;
	if (!first) return fallback;
	const commonSegments = first.filter((segment, index) =>
		segmentsList.every((pathSegs) => pathSegs[index] === segment)
	);

	return commonSegments.length ? commonSegments.join(sep) : fallback;
};

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

	const reactIndexesPath = reactDir && join(reactDir, 'indexes');
	const reactPagesPath = reactDir && join(reactDir, 'pages');
	const htmlPagesPath = htmlDir && join(htmlDir, 'pages');
	const htmlScriptsPath = htmlDir && join(htmlDir, 'scripts');
	const sveltePagesPath = svelteDir && join(svelteDir, 'pages');
	const vuePagesPath = vueDir && join(vueDir, 'pages');
	const htmxPagesPath = htmxDir && join(htmxDir, 'pages');

	const frontends = [reactDir, htmlDir, htmxDir, svelteDir, vueDir].filter(
		Boolean
	);
	const isSingle = frontends.length === 1;

	let serverOutDir;
	if (svelteDir) serverOutDir = join(buildPath, basename(svelteDir), 'pages');
	else if (vueDir) serverOutDir = join(buildPath, basename(vueDir), 'pages');

	let serverRoot;
	if (svelteDir) serverRoot = join(svelteDir, 'pages');
	else if (vueDir) serverRoot = join(vueDir, 'pages');

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

	const serverEntryPoints = [...svelteServerPaths, ...vueServerPaths];
	const clientEntryPoints = [
		...reactEntries,
		...svelteClientPaths,
		...htmlEntries,
		...vueIndexPaths
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
		const roots: string[] = [reactDir, svelteDir, htmlDir, vueDir].filter(
			(dir): dir is string => Boolean(dir)
		);
		const clientRoot = isSingle
			? (roots[0] ?? projectRoot)
			: commonAncestor(roots, projectRoot);
		const { logs, outputs } = await bunBuild({
			define: vueDirectory ? vueFeatureFlags : undefined,
			entrypoints: clientEntryPoints,
			format: 'esm',
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
	for (const log of allLogs) {
		if (log.level === 'error') console.error(log);
		else if (log.level === 'warning') console.warn(log);
		else console.info(log);
	}

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

	if (!options?.preserveIntermediateFiles && svelteDir) {
		await rm(join(svelteDir, 'indexes'), { force: true, recursive: true });
		await rm(join(svelteDir, 'client'), { force: true, recursive: true });
		await Promise.all(
			svelteServerPaths.map((path) => rm(path, { force: true }))
		);
		// TODO: remove when the files are generated inline instead of output
		await rm(join(svelteDir, 'pages', 'example'), {
			force: true,
			recursive: true
		});
	}

	if (!options?.preserveIntermediateFiles && vueDir) {
		await rm(join(vueDir, 'indexes'), { force: true, recursive: true });
		await rm(join(vueDir, 'client'), { force: true, recursive: true });
		await rm(join(vueDir, 'styles'), { force: true, recursive: true });
		await Promise.all(
			vueServerPaths.map((path) => rm(path, { force: true }))
		);
		// TODO: remove when the files are generated inline instead of output
		await rm(join(vueDir, 'pages', 'example'), {
			force: true,
			recursive: true
		});
	}

	if (!options?.preserveIntermediateFiles && reactIndexesPath)
		await rm(reactIndexesPath, { force: true, recursive: true });

	console.log(
		`Build completed in ${getDurationString(performance.now() - buildStart)}`
	);

	return manifest;
};
