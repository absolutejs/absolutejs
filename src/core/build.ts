import { rm, mkdir, cp } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { cwd, exit } from 'node:process';
import { $, BuildArtifact, build as bunBuild } from 'bun';
import { generateManifest } from '../build/generateManifest';
import { generateReactIndexFiles } from '../build/generateReactIndexes';
import { scanEntryPoints } from '../build/scanEntryPoints';
import { updateScriptTags } from '../build/updateScriptTags';
import { compileSvelte } from '../svelte/compileSvelte';
import { BuildConfig } from '../types';
import { getDurationString } from '../utils/getDurationString';
import { validateSafePath } from '../utils/validateSafePath';

export const build = async ({
	buildDirectory = 'build',
	assetsDirectory,
	reactDirectory,
	htmlDirectory,
	htmxDirectory,
	svelteDirectory,
	tailwind,
	options
}: BuildConfig) => {
	const buildStart = performance.now();
	const projectRoot = cwd();

	const buildPath = validateSafePath(buildDirectory, projectRoot);
	const assetsPath =
		assetsDirectory && validateSafePath(assetsDirectory, projectRoot);
	const reactDirectoryPath =
		reactDirectory && validateSafePath(reactDirectory, projectRoot);
	const htmlDirectoryPath =
		htmlDirectory && validateSafePath(htmlDirectory, projectRoot);
	const htmxPath =
		htmxDirectory && validateSafePath(htmxDirectory, projectRoot);
	const svelteDirectoryPath =
		svelteDirectory && validateSafePath(svelteDirectory, projectRoot);

	const reactIndexesPath =
		reactDirectoryPath && join(reactDirectoryPath, 'indexes');
	const reactPagesPath =
		reactDirectoryPath && join(reactDirectoryPath, 'pages');
	const htmlPagesPath = htmlDirectoryPath && join(htmlDirectoryPath, 'pages');
	const htmlScriptsPath =
		htmlDirectoryPath && join(htmlDirectoryPath, 'scripts');
	const sveltePagesPath =
		svelteDirectoryPath && join(svelteDirectoryPath, 'pages');

	const isSingleFrontend =
		[
			reactDirectoryPath,
			htmlDirectoryPath,
			htmxPath,
			svelteDirectoryPath
		].filter(Boolean).length === 1;
	const isSvelteOnly = isSingleFrontend && svelteDirectoryPath !== undefined;

	const serverOutDir = isSvelteOnly ? join(buildPath, 'pages') : buildPath;
	const serverRoot = isSvelteOnly
		? join(svelteDirectoryPath, 'pages')
		: undefined;
	const svelteOutDir = isSingleFrontend
		? buildPath
		: join(buildPath, basename(svelteDirectoryPath ?? ''));
	const svelteDirName = svelteDirectoryPath && basename(svelteDirectoryPath);

	await rm(buildPath, { force: true, recursive: true });
	await mkdir(buildPath);

	if (reactIndexesPath && reactPagesPath) {
		await generateReactIndexFiles(reactPagesPath, reactIndexesPath);
	}

	if (assetsPath) {
		await cp(assetsPath, join(buildPath, 'assets'), {
			force: true,
			recursive: true
		});
	}

	if (htmxPath) {
		await mkdir(join(buildPath, 'htmx'));
		await cp(htmxPath, join(buildPath, 'htmx'), {
			force: true,
			recursive: true
		});
	}

	if (tailwind) {
		await $`bunx @tailwindcss/cli -i ${tailwind.input} -o ${join(buildPath, tailwind.output)}`;
	}

	const reactEntryPoints = reactIndexesPath
		? await scanEntryPoints(reactIndexesPath, '*.tsx')
		: [];
	const svelteEntryPoints = sveltePagesPath
		? await scanEntryPoints(sveltePagesPath, '*.svelte')
		: [];
	const htmlEntryPoints = htmlScriptsPath
		? await scanEntryPoints(htmlScriptsPath, '*.{js,ts}')
		: [];

	const { svelteServerPaths, svelteClientPaths } = svelteDirectoryPath
		? await compileSvelte(svelteEntryPoints, svelteDirectoryPath)
		: { svelteClientPaths: [], svelteServerPaths: [] };

	const serverEntryPoints = [
		...reactEntryPoints,
		...htmlEntryPoints,
		...svelteServerPaths
	];

	if (serverEntryPoints.length === 0) {
		console.warn(
			'No server entry points found, skipping manifest generation'
		);

		return null;
	}

	const { logs: serverLogs, outputs: serverOutputs } = await bunBuild({
		entrypoints: serverEntryPoints,
		format: 'esm',
		naming: `[dir]/[name].[hash].[ext]`,
		outdir: serverOutDir,
		root: serverRoot,
		target: 'bun'
	}).catch((error) => {
		console.error('Server build failed:', error);
		exit(1);
	});

	let clientLogs: (BuildMessage | ResolveMessage)[] = [];
	let clientOutputs: BuildArtifact[] = [];

	if (svelteDirectoryPath) {
		const { logs, outputs } = await bunBuild({
			entrypoints: svelteClientPaths,
			format: 'esm',
			naming: `[dir]/[name].[hash].[ext]`,
			outdir: svelteOutDir,
			root: svelteDirectoryPath,
			target: 'browser'
		}).catch((error) => {
			console.error('Client build failed:', error);
			exit(1);
		});

		clientLogs = logs;
		clientOutputs = outputs;
	}

	[...serverLogs, ...clientLogs].forEach((log) => {
		if (log.level === 'error') console.error(log);
		else if (log.level === 'warning') console.warn(log);
		else console.info(log);
	});

	const manifest = generateManifest(
		[...serverOutputs, ...clientOutputs],
		buildPath,
		svelteDirName
	);

	if (htmlDirectoryPath && htmlPagesPath) {
		const outputHtmlPages = join(
			buildPath,
			basename(htmlDirectoryPath),
			'pages'
		);
		await mkdir(outputHtmlPages, { recursive: true });
		await cp(htmlPagesPath, outputHtmlPages, {
			force: true,
			recursive: true
		});
		await updateScriptTags(manifest, outputHtmlPages);
	}

	if (!options?.preserveIntermediateFiles && svelteDirectoryPath) {
		await rm(join(svelteDirectoryPath, 'indexes'), {
			force: true,
			recursive: true
		});
		await rm(join(svelteDirectoryPath, 'client'), {
			force: true,
			recursive: true
		});
		await Promise.all(
			svelteServerPaths.map((filePath) => rm(filePath, { force: true }))
		);
	}

	if (!options?.preserveIntermediateFiles && reactIndexesPath) {
		await rm(reactIndexesPath, { force: true, recursive: true });
	}

	console.log(
		`Build completed in ${getDurationString(performance.now() - buildStart)}`
	);

	return manifest;
};
