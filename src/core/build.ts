import { rm, mkdir, cp } from "node:fs/promises";
import { basename, join } from "node:path";
import { cwd, exit } from "node:process";
import { $, build as bunBuild } from "bun";
import { generateManifest } from "../build/generateManifest";
import { generateReactIndexFiles } from "../build/generateReactIndexes";
import { scanEntryPoints } from "../build/scanEntryPoints";
import { updateScriptTags } from "../build/updateScriptTags";
import { compileSvelte } from "../svelte/compileSvelte";
import { BuildConfig } from "../types";
import { getDurationString } from "../utils/getDurationString";
import { validateSafePath } from "../utils/validateSafePath";

export const build = async ({
	buildDirectory = "build",
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
	const reactIndexesPath =
		reactDirectoryPath && join(projectRoot, reactDirectoryPath, "indexes");
	const reactPagesPath =
		reactDirectoryPath && join(projectRoot, reactDirectoryPath, "pages");
	const htmlDirectoryPath =
		htmlDirectory && validateSafePath(htmlDirectory, projectRoot);
	const htmlPagesPath = htmlDirectoryPath
		? join(projectRoot, htmlDirectoryPath, "pages")
		: undefined;
	const htmlScriptsPath = htmlDirectoryPath
		? join(projectRoot, htmlDirectoryPath, "scripts")
		: undefined;
	const svelteDirectoryPath =
		svelteDirectory && validateSafePath(svelteDirectory, projectRoot);
	const svelteBuildPath =
		svelteDirectoryPath && join(projectRoot, svelteDirectoryPath);
	const htmxPath =
		htmxDirectory && validateSafePath(htmxDirectory, projectRoot);

	await rm(buildPath, { force: true, recursive: true });
	await mkdir(buildPath);

	if (reactIndexesPath && reactPagesPath) {
		await generateReactIndexFiles(reactPagesPath, reactIndexesPath);
	}

	if (assetsPath) {
		await cp(assetsPath, join(buildPath, "assets"), {
			force: true,
			recursive: true
		});
	}

	if (htmxPath) {
		await mkdir(join(buildPath, "htmx"));
		await cp(htmxPath, join(buildPath, "htmx"), {
			force: true,
			recursive: true
		});
	}

	if (tailwind) {
		await $`bunx @tailwindcss/cli -i ${tailwind.input} -o ${join(
			buildPath,
			tailwind.output
		)}`;
	}

	const reactEntryPoints = reactIndexesPath
		? await scanEntryPoints(reactIndexesPath, "*.tsx")
		: [];
	const svelteEntryPoints = svelteBuildPath
		? await scanEntryPoints(join(svelteBuildPath, "pages"), "*.svelte")
		: [];
	const htmlEntryPoints = htmlScriptsPath
		? await scanEntryPoints(htmlScriptsPath, "*.{js,ts}")
		: [];

	const { svelteServerPaths, svelteClientPaths } = svelteBuildPath
		? await compileSvelte(svelteEntryPoints, svelteBuildPath)
		: { svelteClientPaths: [], svelteServerPaths: [] };

	const serverEntryPoints = reactEntryPoints
		.concat(htmlEntryPoints)
		.concat(svelteServerPaths);

	if (serverEntryPoints.length === 0) {
		console.warn(
			"No server entry points found, skipping manifest generation"
		);

		return null;
	}

	const { logs: serverLogs, outputs: serverOutputs } = await bunBuild({
		entrypoints: serverEntryPoints,
		format: "esm",
		naming: `[dir]/[name].[hash].[ext]`,
		outdir: buildPath,
		target: "bun"
	}).catch((error) => {
		console.error("Server build failed:", error);
		exit(1);
	});

	let clientLogs: typeof serverLogs = [];
	let clientOutputs: typeof serverOutputs = [];
	if (svelteDirectory) {
		const { logs, outputs } = await bunBuild({
			entrypoints: svelteClientPaths,
			format: "esm",
			naming: `[dir]/[name].[hash].[ext]`,
			outdir: join(buildPath, "svelte"),
			root: svelteBuildPath,
			target: "browser"
		}).catch((error) => {
			console.error("Client build failed:", error);
			exit(1);
		});
		clientLogs = logs;
		clientOutputs = outputs;
	}

	serverLogs.concat(clientLogs).forEach((log) => {
		if (log.level === "error") console.error(log);
		else if (log.level === "warning") console.warn(log);
		else console.info(log);
	});

	const allOutputs = serverOutputs.concat(clientOutputs);
	const manifest = generateManifest(allOutputs, buildPath);

	if (htmlDirectory && htmlPagesPath) {
		const outputHtmlPages = join(
			buildPath,
			basename(htmlDirectory),
			"pages"
		);
		await mkdir(outputHtmlPages, { recursive: true });
		await cp(htmlPagesPath, outputHtmlPages, {
			force: true,
			recursive: true
		});
		await updateScriptTags(manifest, outputHtmlPages);
	}

	if (!options?.preserveIntermediateFiles && svelteBuildPath) {
		await rm(join(svelteBuildPath, "indexes"), {
			force: true,
			recursive: true
		});
		await rm(join(svelteBuildPath, "client"), {
			force: true,
			recursive: true
		});
		svelteServerPaths.forEach(async (path) => {
			await rm(path, { force: true });
		});
	}

	if (!options?.preserveIntermediateFiles && reactIndexesPath) {
		await rm(reactIndexesPath, { force: true, recursive: true });
	}

	const buildDuration = performance.now() - buildStart;
	console.log(`Build completed in ${getDurationString(buildDuration)}`);

	return manifest;
};
