import { rm, mkdir, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { cwd, exit } from "node:process";
import { $, build as bunBuild, Glob } from "bun";
import {
	MILLISECONDS_IN_A_MINUTE,
	MILLISECONDS_IN_A_SECOND,
	TIME_PRECISION
} from "../constants";
import { BuildConfig } from "../types";
import { updateScriptTags } from "../utils/updateScriptTags";

export const build = async ({
	buildDirectory = "build",
	assetsDirectory,
	reactDirectory,
	html,
	htmxDirectory,
	tailwind
}: BuildConfig) => {
	const start = performance.now();

	const projectRoot = cwd();
	const buildDirAbsolute = join(projectRoot, buildDirectory);
	const assetsDirAbsolute =
		assetsDirectory && join(projectRoot, assetsDirectory);
	const reactIndexDirAbsolute =
		reactDirectory && join(projectRoot, reactDirectory, "indexes");
	const reactPagesDirAbsolute =
		reactDirectory && join(projectRoot, reactDirectory, "pages");
	const htmlDirAbsolute = html?.directory
		? join(projectRoot, html.directory)
		: undefined;

	const htmxDirAbsolute = htmxDirectory && join(projectRoot, htmxDirectory);

	await rm(buildDirAbsolute, { force: true, recursive: true });
	await mkdir(buildDirAbsolute);

	reactPagesDirAbsolute &&
		reactIndexDirAbsolute &&
		(await generateReactIndexFiles(
			reactPagesDirAbsolute,
			reactIndexDirAbsolute
		));

	const reactEntryPaths =
		reactIndexDirAbsolute &&
		(await scanEntryPoints(reactIndexDirAbsolute, "*.tsx"));

	const entryPaths = [...(reactEntryPaths ?? [])];

	if (entryPaths.length === 0) {
		console.warn("No entry points found, skipping build");

		return null;
	}

	const { logs, outputs } = await bunBuild({
		entrypoints: entryPaths,
		format: "esm",
		naming: `[dir]/[name].[hash].[ext]`,
		outdir: buildDirAbsolute,
		target: "bun"
	}).catch((error) => {
		console.error("Build failed:", error);
		exit(1);
	});

	logs.forEach((log) => {
		if (log.level === "error") console.error(log);
		else if (log.level === "warning") console.warn(log);
		else if (log.level === "info" || log.level === "debug")
			console.info(log);
	});

	assetsDirAbsolute &&
		(await $`cp -R ${assetsDirAbsolute} ${buildDirAbsolute}`);

	if (htmlDirAbsolute) {
		await mkdir(join(buildDirAbsolute, "html"));
		await $`cp -R ${htmlDirAbsolute} ${join(buildDirAbsolute)}`;
	}

	if (htmxDirAbsolute) {
		await mkdir(join(buildDirAbsolute, "htmx"));
		await $`cp -R ${htmxDirAbsolute} ${join(buildDirAbsolute)}`;
	}

	if (tailwind) {
		await $`bunx @tailwindcss/cli -i ${tailwind.input} -o ${join(buildDirAbsolute, tailwind.output)}`;
	}

	const manifest = outputs.reduce<Record<string, string>>((acc, artifact) => {
		let relativePath = artifact.path;

		if (relativePath.startsWith(buildDirAbsolute)) {
			relativePath = relativePath.slice(buildDirAbsolute.length);
		}

		relativePath = relativePath.replace(/^\/+/, "");

		const baseName = relativePath.split("/").pop();
		if (!baseName) return acc;

		const hashDelimiter = `.${artifact.hash}.`;
		if (!baseName.includes(hashDelimiter)) {
			throw new Error(
				`Expected hash delimiter ${hashDelimiter} in ${baseName}`
			);
		}

		const [fileName] = baseName.split(hashDelimiter);
		acc[fileName] = `/${relativePath}`;

		return acc;
	}, {});

	htmlDirAbsolute && (await updateScriptTags(manifest, htmlDirAbsolute));

	const end = performance.now();
	const durationMs = end - start;
	let duration;
	if (durationMs < MILLISECONDS_IN_A_SECOND) {
		duration = `${durationMs.toFixed(TIME_PRECISION)}ms`;
	} else if (durationMs < MILLISECONDS_IN_A_MINUTE) {
		duration = `${(durationMs / MILLISECONDS_IN_A_SECOND).toFixed(TIME_PRECISION)}s`;
	} else {
		duration = `${(durationMs / MILLISECONDS_IN_A_MINUTE).toFixed(TIME_PRECISION)}m`;
	}
	console.log(`Build completed in ${duration}`);

	return manifest;
};

const generateReactIndexFiles = async (
	reactPagesDirAbsolute: string,
	reactIndexDirAbsolute: string
) => {
	await rm(reactIndexDirAbsolute, { force: true, recursive: true });
	await mkdir(reactIndexDirAbsolute);

	const pagesGlob = new Glob("*.*");
	const files: string[] = [];
	for await (const file of pagesGlob.scan({ cwd: reactPagesDirAbsolute })) {
		files.push(file);
	}
	const promises = files.map(async (file) => {
		const fileName = basename(file);
		const [componentName] = fileName.split(".");
		const content = [
			`import { hydrateRoot } from 'react-dom/client';`,
			`import { ${componentName} } from '../pages/${componentName}';\n`,
			`hydrateRoot(document, <${componentName} />);`
		].join("\n");

		return writeFile(
			join(reactIndexDirAbsolute, `${componentName}Index.tsx`),
			content
		);
	});
	await Promise.all(promises);
};

const scanEntryPoints = async (dir: string, pattern: string) => {
	const entryPaths: string[] = [];
	const glob = new Glob(pattern);
	for await (const file of glob.scan({ absolute: true, cwd: dir })) {
		entryPaths.push(file);
	}

	return entryPaths;
};
