import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { cwd, exit } from "node:process";
import { $, build as bunBuild } from "bun";
import { compileSvelte } from "../build/compileSvelte";
import { generateManifest } from "../build/generateManifest";
import { generateReactIndexFiles } from "../build/generateReactIndexes";
import { scanEntryPoints } from "../build/scanEntryPoints";
import { updateScriptTags } from "../build/updateScriptTags";
import { BuildConfig } from "../types";
import { getDurationString } from "../utils/getDurationString";

export const build = async ({
	buildDirectory = "build",
	assetsDirectory,
	reactDirectory,
	htmlDirectory,
	htmxDirectory,
	svelteDirectory,
	tailwind
}: BuildConfig) => {
	const buildStart = performance.now();
	const projectRoot = cwd();

	const buildPath = join(projectRoot, buildDirectory);
	const assetsPath = assetsDirectory
		? join(projectRoot, assetsDirectory)
		: undefined;

	const reactIndexesPath = reactDirectory
		? join(projectRoot, reactDirectory, "indexes")
		: undefined;
	const reactPagesPath = reactDirectory
		? join(projectRoot, reactDirectory, "pages")
		: undefined;

	const htmlPagesPath = htmlDirectory
		? join(projectRoot, htmlDirectory, "pages")
		: undefined;
	const htmlScriptsPath = htmlDirectory
		? join(projectRoot, htmlDirectory, "scripts")
		: undefined;

	const svelteBuildPath = svelteDirectory
		? join(projectRoot, svelteDirectory)
		: undefined;

	const htmxPath = htmxDirectory
		? join(projectRoot, htmxDirectory)
		: undefined;

	await rm(buildPath, { force: true, recursive: true });
	await mkdir(buildPath);

	if (reactIndexesPath && reactPagesPath) {
		await generateReactIndexFiles(reactPagesPath, reactIndexesPath);
	}

	if (assetsPath) {
		await $`cp -R ${assetsPath} ${buildPath}`;
	}

	if (htmlPagesPath) {
		const outputHtmlPages = join(buildPath, "html", "pages");
		await mkdir(outputHtmlPages, { recursive: true });
		await $`cp -R ${htmlPagesPath} ${join(buildPath, "html")}`;
	}

	if (htmxPath) {
		await mkdir(join(buildPath, "htmx"));
		await $`cp -R ${htmxPath} ${buildPath}`;
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

	const { logs: clientLogs, outputs: clientOutputs } = await bunBuild({
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

	serverLogs.concat(clientLogs).forEach((log) => {
		if (log.level === "error") console.error(log);
		else if (log.level === "warning") console.warn(log);
		else console.info(log);
	});

	const allOutputs = serverOutputs.concat(clientOutputs);
	const manifest = generateManifest(allOutputs, buildPath);

	if (htmlPagesPath) {
		await updateScriptTags(manifest, join(buildPath, "html", "pages"));
	}

	if (svelteBuildPath) {
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

	const buildDuration = performance.now() - buildStart;
	console.log(`Build completed in ${getDurationString(buildDuration)}`);

	return manifest;
};
