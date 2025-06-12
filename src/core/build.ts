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
	htmlDirectory,
	htmxDirectory,
	tailwind
}: BuildConfig) => {
	const start = performance.now();

	const projectRoot = cwd();
	const buildDirectoryAbsolute = join(projectRoot, buildDirectory);
	const assetsDirectoryAbsolute =
		assetsDirectory && join(projectRoot, assetsDirectory);
	const reactIndexesDirectory =
		reactDirectory && join(projectRoot, reactDirectory, "indexes");
	const reactPagesDirectory =
		reactDirectory && join(projectRoot, reactDirectory, "pages");
	const htmlPagesDirectory =
		htmlDirectory && join(projectRoot, htmlDirectory, "pages");
	const htmlScriptsDirectory =
		htmlDirectory && join(projectRoot, htmlDirectory, "scripts");
	const htmxDirectoryAbsolute =
		htmxDirectory && join(projectRoot, htmxDirectory);

	await rm(buildDirectoryAbsolute, { force: true, recursive: true });
	await mkdir(buildDirectoryAbsolute);

	void (
		reactPagesDirectory &&
		reactIndexesDirectory &&
		(await generateReactIndexFiles(
			reactPagesDirectory,
			reactIndexesDirectory
		))
	);

	void (
		assetsDirectoryAbsolute &&
		(await $`cp -R ${assetsDirectoryAbsolute} ${buildDirectoryAbsolute}`)
	);

	if (htmlPagesDirectory) {
		await mkdir(join(buildDirectoryAbsolute, "html", "pages"), {
			recursive: true
		});
		await $`cp -R ${htmlPagesDirectory} ${join(buildDirectoryAbsolute, "html")}`;
	}

	if (htmxDirectoryAbsolute) {
		await mkdir(join(buildDirectoryAbsolute, "htmx"));
		await $`cp -R ${htmxDirectoryAbsolute} ${join(buildDirectoryAbsolute)}`;
	}

	if (tailwind) {
		await $`bunx @tailwindcss/cli -i ${tailwind.input} -o ${join(buildDirectoryAbsolute, tailwind.output)}`;
	}

	const reactEntryPaths =
		reactIndexesDirectory &&
		(await scanEntryPoints(reactIndexesDirectory, "*.tsx"));

	const htmlEntryPaths =
		htmlScriptsDirectory &&
		(await scanEntryPoints(htmlScriptsDirectory, "*.{js,ts}"));

	const entryPaths = [...(reactEntryPaths || []), ...(htmlEntryPaths || [])];

	if (entryPaths.length === 0) {
		console.warn("No entry points found, skipping building manifest");

		return null;
	}

	const { logs, outputs } = await bunBuild({
		entrypoints: entryPaths,
		format: "esm",
		naming: `[dir]/[name].[hash].[ext]`,
		outdir: buildDirectoryAbsolute,
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

	const manifest = outputs.reduce<Record<string, string>>((acc, artifact) => {
		let relativePath = artifact.path;

		if (relativePath.startsWith(buildDirectoryAbsolute)) {
			relativePath = relativePath.slice(buildDirectoryAbsolute.length);
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

	void (
		htmlPagesDirectory &&
		(await updateScriptTags(
			manifest,
			join(buildDirectoryAbsolute, "html", "pages")
		))
	);

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
	reactPagesDirectory: string,
	reactIndexesDirectory: string
) => {
	await rm(reactIndexesDirectory, { force: true, recursive: true });
	await mkdir(reactIndexesDirectory);

	const pagesGlob = new Glob("*.*");
	const files: string[] = [];
	for await (const file of pagesGlob.scan({ cwd: reactPagesDirectory })) {
		files.push(file);
	}
	const promises = files.map(async (file) => {
		const fileName = basename(file);
		const [componentName] = fileName.split(".");
		const content = [
			`import { hydrateRoot } from 'react-dom/client';`,
			`import type { ComponentType } from 'react'`,
			`import { ${componentName} } from '../pages/${componentName}';\n`,
			`type PropsOf<C> = C extends ComponentType<infer P> ? P : never;\n`,
			`declare global {
				interface Window {
					__INITIAL_PROPS__: PropsOf<typeof ReactExample>
				}
			}\n`,
			`hydrateRoot(document, <${componentName} {...window.__INITIAL_PROPS__} />);`
		].join("\n");

		return writeFile(
			join(reactIndexesDirectory, `${componentName}Index.tsx`),
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
