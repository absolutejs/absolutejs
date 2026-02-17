import {
	copyFileSync,
	cpSync,
	mkdirSync,
	readFileSync,
	writeFileSync
} from 'node:fs';
import { rm } from 'node:fs/promises';
import { basename, join, resolve, dirname, relative } from 'node:path';
import { cwd, env, exit } from 'node:process';
import { $, build as bunBuild, BuildArtifact, Glob } from 'bun';
import { compileSvelte } from '../build/compileSvelte';
import { compileVue } from '../build/compileVue';
import { generateManifest } from '../build/generateManifest';
import { generateReactIndexFiles } from '../build/generateReactIndexes';
import { createHTMLScriptHMRPlugin } from '../build/htmlScriptHMRPlugin';
import { outputLogs } from '../build/outputLogs';
import { scanEntryPoints } from '../build/scanEntryPoints';
import { updateAssetPaths } from '../build/updateAssetPaths';
import { buildHMRClient } from '../dev/buildHMRClient';
import type { BuildConfig } from '../../types/build';
import { cleanup } from '../utils/cleanup';
import { commonAncestor } from '../utils/commonAncestor';
import { getDurationString } from '../utils/getDurationString';
import { logger } from '../utils/logger';
import { normalizePath } from '../utils/normalizePath';
import { toPascal } from '../utils/stringModifiers';
import { validateSafePath } from '../utils/validateSafePath';

const isDev = env.NODE_ENV !== 'production';

const vueFeatureFlags: Record<string, string> = {
	__VUE_OPTIONS_API__: 'true',
	__VUE_PROD_DEVTOOLS__: isDev ? 'true' : 'false',
	__VUE_PROD_HYDRATION_MISMATCH_DETAILS__: isDev ? 'true' : 'false'
};

export const build = async ({
	buildDirectory = 'build',
	assetsDirectory,
	publicDirectory,
	reactDirectory,
	htmlDirectory,
	htmxDirectory,
	angularDirectory,
	svelteDirectory,
	vueDirectory,
	tailwind,
	options,
	incrementalFiles
}: BuildConfig) => {
	const buildStart = performance.now();
	const projectRoot = cwd();
	const isIncremental = incrementalFiles && incrementalFiles.length > 0;

	// Normalize incrementalFiles for consistent cross-platform path checking
	const normalizedIncrementalFiles = incrementalFiles?.map(normalizePath);

	if (isIncremental) {
		console.log(
			`⚡ Incremental build: ${incrementalFiles.length} file(s) to rebuild`
		);
	}

	const throwOnError = options?.throwOnError === true;
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

	// Shared root for all client builds so output paths preserve framework directory names.
	// generateManifest detects frameworks by checking for "react"/"svelte"/"vue" path segments.
	const clientRoots: string[] = [
		reactDir,
		svelteDir,
		htmlDir,
		vueDir,
		angularDir
	].filter((dir): dir is string => Boolean(dir));
	const clientRoot = isSingle
		? (clientRoots[0] ?? projectRoot)
		: commonAncestor(clientRoots, projectRoot);

	let serverOutDir;
	if (svelteDir) serverOutDir = join(buildPath, basename(svelteDir), 'pages');
	else if (vueDir) serverOutDir = join(buildPath, basename(vueDir), 'pages');

	let serverRoot;
	if (sveltePagesPath) serverRoot = sveltePagesPath;
	else if (vuePagesPath) serverRoot = vuePagesPath;

	const publicPath =
		publicDirectory && validateSafePath(publicDirectory, projectRoot);

	// Only delete build directory for full builds, not incremental
	if (!isIncremental) {
		await rm(buildPath, { force: true, recursive: true });
	}
	mkdirSync(buildPath, { recursive: true });

	if (publicPath)
		cpSync(publicPath, buildPath, { force: true, recursive: true });

	// Helper to find matching entry points for incremental files
	// The dependency graph already includes all dependent files in incrementalFiles
	const filterToIncrementalEntries = (
		entryPoints: string[],
		mapToSource: (entry: string) => string | null
	) => {
		if (!isIncremental || !incrementalFiles) return entryPoints;

		const normalizedIncremental = new Set(
			incrementalFiles.map((f) => resolve(f))
		);
		const matchingEntries: string[] = [];

		for (const entry of entryPoints) {
			const sourceFile = mapToSource(entry);
			if (sourceFile && normalizedIncremental.has(resolve(sourceFile))) {
				matchingEntries.push(entry);
			}
		}

		return matchingEntries;
	};

	// For incremental React builds, only generate indexes for changed files
	// NOTE: We always regenerate index files to ensure they have the latest hydration error handling logic
	if (reactIndexesPath && reactPagesPath) {
		// Always regenerate React index files to ensure latest error handling is included
		// This is safe because index files are small and generation is fast
		await generateReactIndexFiles(reactPagesPath, reactIndexesPath, isDev);
	}

	// Copy assets on full builds or if assets changed
	if (
		assetsPath &&
		(!isIncremental ||
			normalizedIncrementalFiles?.some((f) => f.includes('/assets/')))
	) {
		cpSync(assetsPath, join(buildPath, 'assets'), {
			force: true,
			recursive: true
		});
	}

	// Tailwind only on full builds or if CSS changed
	if (
		tailwind &&
		(!isIncremental ||
			normalizedIncrementalFiles?.some((f) => f.endsWith('.css')))
	) {
		await $`bunx @tailwindcss/cli -i ${tailwind.input} -o ${join(buildPath, tailwind.output)}`;
	}

	const allReactEntries = reactIndexesPath
		? await scanEntryPoints(reactIndexesPath, '*.tsx')
		: [];
	const allHtmlEntries = htmlScriptsPath
		? await scanEntryPoints(htmlScriptsPath, '*.{js,ts}')
		: [];
	const allSvelteEntries = sveltePagesPath
		? await scanEntryPoints(sveltePagesPath, '*.svelte')
		: [];
	const allVueEntries = vuePagesPath
		? await scanEntryPoints(vuePagesPath, '*.vue')
		: [];
	const allAngularEntries = angularPagesPath
		? await scanEntryPoints(angularPagesPath, '*.ts')
		: [];

	const allHtmlCssEntries = htmlDir
		? await scanEntryPoints(join(htmlDir, 'styles'), '*.css')
		: [];
	const allHtmxCssEntries = htmxDir
		? await scanEntryPoints(join(htmxDir, 'styles'), '*.css')
		: [];
	const allReactCssEntries = reactDir
		? await scanEntryPoints(join(reactDir, 'styles'), '*.css')
		: [];
	const allSvelteCssEntries = svelteDir
		? await scanEntryPoints(join(svelteDir, 'styles'), '*.css')
		: [];

	// When HTML/HTMX pages change, we must include their CSS and scripts in the build
	// so the manifest has those entries for updateAssetPaths. Otherwise incremental
	// builds drop them and updateAssetPaths fails with "no manifest entry".
	const shouldIncludeHtmlAssets =
		!isIncremental ||
		normalizedIncrementalFiles?.some(
			(f) =>
				f.includes('/html/') &&
				(f.endsWith('.html') || f.endsWith('.css'))
		);
	const shouldIncludeHtmxAssets =
		!isIncremental ||
		normalizedIncrementalFiles?.some(
			(f) =>
				f.includes('/htmx/') &&
				(f.endsWith('.html') || f.endsWith('.css'))
		);

	// Filter entries for incremental builds
	// For React: map index entries back to their source pages
	const reactEntries =
		isIncremental && reactIndexesPath && reactPagesPath
			? filterToIncrementalEntries(allReactEntries, (entry) => {
					// Map index entry (indexes/ReactExample.tsx) to source page (pages/ReactExample.tsx)
					if (entry.startsWith(resolve(reactIndexesPath))) {
						const pageName = basename(entry, '.tsx');
						return join(reactPagesPath, `${pageName}.tsx`);
					}
					return null;
				})
			: allReactEntries;

	const htmlEntries =
		isIncremental && htmlScriptsPath && !shouldIncludeHtmlAssets
			? filterToIncrementalEntries(allHtmlEntries, (entry) => entry)
			: allHtmlEntries;

	// For Svelte/Vue/Angular: entries are the page files themselves
	const svelteEntries = isIncremental
		? filterToIncrementalEntries(allSvelteEntries, (entry) => entry)
		: allSvelteEntries;

	const vueEntries = isIncremental
		? filterToIncrementalEntries(allVueEntries, (entry) => entry)
		: allVueEntries;

	const angularEntries = isIncremental
		? filterToIncrementalEntries(allAngularEntries, (entry) => entry)
		: allAngularEntries;

	// CSS entries - entries are the CSS files themselves
	const htmlCssEntries =
		isIncremental && !shouldIncludeHtmlAssets
			? filterToIncrementalEntries(allHtmlCssEntries, (entry) => entry)
			: allHtmlCssEntries;
	const htmxCssEntries =
		isIncremental && !shouldIncludeHtmxAssets
			? filterToIncrementalEntries(allHtmxCssEntries, (entry) => entry)
			: allHtmxCssEntries;
	const reactCssEntries = isIncremental
		? filterToIncrementalEntries(allReactCssEntries, (entry) => entry)
		: allReactCssEntries;
	const svelteCssEntries = isIncremental
		? filterToIncrementalEntries(allSvelteCssEntries, (entry) => entry)
		: allSvelteCssEntries;

	const { svelteServerPaths, svelteIndexPaths, svelteClientPaths } = svelteDir
		? await compileSvelte(svelteEntries, svelteDir, new Map(), isDev)
		: {
				svelteClientPaths: [],
				svelteIndexPaths: [],
				svelteServerPaths: []
			};

	const { vueServerPaths, vueIndexPaths, vueClientPaths, vueCssPaths } =
		vueDir
			? await compileVue(vueEntries, vueDir, isDev)
			: {
					vueClientPaths: [],
					vueCssPaths: [],
					vueIndexPaths: [],
					vueServerPaths: []
				};

	const serverEntryPoints = [...svelteServerPaths, ...vueServerPaths];
	const reactClientEntryPoints = [...reactEntries];
	const nonReactClientEntryPoints = [
		...svelteIndexPaths,
		...svelteClientPaths,
		...htmlEntries,
		...vueIndexPaths,
		...vueClientPaths
	];
	const cssEntryPoints = [
		...vueCssPaths,
		...reactCssEntries,
		...svelteCssEntries,
		...htmlCssEntries,
		...htmxCssEntries
	];

	if (
		serverEntryPoints.length === 0 &&
		reactClientEntryPoints.length === 0 &&
		nonReactClientEntryPoints.length === 0 &&
		htmxDir === undefined &&
		htmlDir === undefined
	) {
		logger.warn('No entry points found, manifest will be empty');

		return {};
	}

	let serverLogs: (BuildMessage | ResolveMessage)[] = [];
	let serverOutputs: BuildArtifact[] = [];

	if (serverEntryPoints.length > 0) {
		const result = await bunBuild({
			entrypoints: serverEntryPoints,
			format: 'esm',
			naming: `[dir]/[name].[hash].[ext]`,
			outdir: serverOutDir,
			root: serverRoot,
			target: 'bun',
			throw: false
		});
		serverLogs = result.logs;
		serverOutputs = result.outputs;
		if (!result.success && result.logs.length > 0) {
			const errLog =
				result.logs.find((l) => l.level === 'error') ?? result.logs[0]!;
			const err = new Error(
				typeof errLog.message === 'string'
					? errLog.message
					: String(errLog.message)
			);
			(err as Error & { logs?: unknown }).logs = result.logs;
			logger.error('Server build failed', err);
			if (throwOnError) throw err;
			exit(1);
		}
	}

	let reactClientLogs: (BuildMessage | ResolveMessage)[] = [];
	let reactClientOutputs: BuildArtifact[] = [];

	// In dev, add the _refresh entry to force React into a shared chunk
	// so HMR can re-import component entries without duplicating React.
	if (isDev && reactIndexesPath) {
		const refreshEntry = join(reactIndexesPath, '_refresh.tsx');
		if (!reactClientEntryPoints.includes(refreshEntry)) {
			reactClientEntryPoints.push(refreshEntry);
		}
	}

	if (reactClientEntryPoints.length > 0) {
		const reactBuildConfig = {
			entrypoints: reactClientEntryPoints,
			format: 'esm' as const,
			minify: !isDev,
			naming: `[dir]/[name].[hash].[ext]`,
			outdir: buildPath,
			root: clientRoot,
			splitting: true,
			target: 'browser' as const,
			throw: false
		};

		// Bun's reactFastRefresh option injects $RefreshReg$/$RefreshSig$
		// calls for React Fast Refresh support in dev
		if (isDev) {
			(reactBuildConfig as Record<string, unknown>).reactFastRefresh =
				true;
		}

		const reactClientResult = await bunBuild(reactBuildConfig);
		reactClientLogs = reactClientResult.logs;
		reactClientOutputs = reactClientResult.outputs;
		if (!reactClientResult.success && reactClientResult.logs.length > 0) {
			const errLog =
				reactClientResult.logs.find((l) => l.level === 'error') ??
				reactClientResult.logs[0]!;
			const err = new Error(
				typeof errLog.message === 'string'
					? errLog.message
					: String(errLog.message)
			);
			(err as Error & { logs?: unknown }).logs = reactClientResult.logs;
			logger.error('React client build failed', err);
			if (throwOnError) throw err;
			exit(1);
		}
	}

	let nonReactClientLogs: (BuildMessage | ResolveMessage)[] = [];
	let nonReactClientOutputs: BuildArtifact[] = [];

	if (nonReactClientEntryPoints.length > 0) {
		const htmlScriptPlugin = isDev
			? createHTMLScriptHMRPlugin(htmlDir, htmxDir)
			: undefined;

		const nonReactClientResult = await bunBuild({
			define: vueDirectory ? vueFeatureFlags : undefined,
			entrypoints: nonReactClientEntryPoints,
			format: 'esm',
			minify: !isDev,
			naming: `[dir]/[name].[hash].[ext]`,
			outdir: buildPath,
			plugins: htmlScriptPlugin ? [htmlScriptPlugin] : undefined,
			root: clientRoot,
			target: 'browser',
			splitting: !isDev,
			throw: false
		});
		nonReactClientLogs = nonReactClientResult.logs;
		nonReactClientOutputs = nonReactClientResult.outputs;
		if (
			!nonReactClientResult.success &&
			nonReactClientResult.logs.length > 0
		) {
			const errLog =
				nonReactClientResult.logs.find((l) => l.level === 'error') ??
				nonReactClientResult.logs[0]!;
			const err = new Error(
				typeof errLog.message === 'string'
					? errLog.message
					: String(errLog.message)
			);
			(err as Error & { logs?: unknown }).logs =
				nonReactClientResult.logs;
			logger.error('Non-React client build failed', err);
			if (throwOnError) throw err;
			exit(1);
		}
	}

	let cssLogs: (BuildMessage | ResolveMessage)[] = [];
	let cssOutputs: BuildArtifact[] = [];

	if (cssEntryPoints.length > 0) {
		const cssResult = await bunBuild({
			entrypoints: cssEntryPoints,
			naming: `[name].[hash].[ext]`,
			outdir: join(
				buildPath,
				assetsPath ? basename(assetsPath) : 'assets',
				'css'
			),
			target: 'browser',
			throw: false
		});
		cssLogs = cssResult.logs;
		cssOutputs = cssResult.outputs;
		if (!cssResult.success && cssResult.logs.length > 0) {
			const errLog =
				cssResult.logs.find((l) => l.level === 'error') ??
				cssResult.logs[0]!;
			const err = new Error(
				typeof errLog.message === 'string'
					? errLog.message
					: String(errLog.message)
			);
			(err as Error & { logs?: unknown }).logs = cssResult.logs;
			logger.error('CSS build failed', err);
			if (throwOnError) throw err;
			exit(1);
		}
	}

	const allLogs = [
		...serverLogs,
		...reactClientLogs,
		...nonReactClientLogs,
		...cssLogs
	];
	outputLogs(allLogs);

	const manifest = generateManifest(
		[
			...serverOutputs,
			...reactClientOutputs,
			...nonReactClientOutputs,
			...cssOutputs
		],
		buildPath
	);

	// Svelte/Vue server pages need absolute file paths for SSR import(),
	// not web-relative paths. Overwrite with absolute paths like HTML/HTMX.
	for (const artifact of serverOutputs) {
		const fileWithHash = basename(artifact.path);
		const [baseName] = fileWithHash.split(`.${artifact.hash}.`);
		if (!baseName) continue;
		manifest[toPascal(baseName)] = artifact.path;
	}

	// For HTML/HTMX, copy pages on full builds or if HTML/HTMX files changed
	// Also update asset paths if CSS changed (to update CSS links in HTML files)
	const htmlOrHtmlCssChanged =
		!isIncremental ||
		normalizedIncrementalFiles?.some(
			(f) =>
				f.includes('/html/') &&
				(f.endsWith('.html') || f.endsWith('.css'))
		);
	const htmxOrHtmxCssChanged =
		!isIncremental ||
		normalizedIncrementalFiles?.some(
			(f) =>
				f.includes('/htmx/') &&
				(f.endsWith('.html') || f.endsWith('.css'))
		);

	const shouldCopyHtml = htmlOrHtmlCssChanged;
	const shouldCopyHtmx = htmxOrHtmxCssChanged;

	// Update asset paths if CSS changed (even if HTML files didn't change)
	const shouldUpdateHtmlAssetPaths =
		!isIncremental ||
		normalizedIncrementalFiles?.some(
			(f) =>
				f.includes('/html/') &&
				(f.endsWith('.html') || f.endsWith('.css'))
		);
	const shouldUpdateHtmxAssetPaths =
		!isIncremental ||
		normalizedIncrementalFiles?.some(
			(f) =>
				f.includes('/htmx/') &&
				(f.endsWith('.html') || f.endsWith('.css'))
		);

	// Build HMR client bundle once for HTML/HTMX injection during dev builds
	const hmrClientBundle =
		isDev && (htmlDir || htmxDir) ? await buildHMRClient() : null;

	const injectHMRIntoHTMLFile = (filePath: string, framework: string) => {
		if (!hmrClientBundle) return;
		let html = readFileSync(filePath, 'utf-8');
		if (html.includes('data-hmr-client')) return;
		const tag =
			`<script>window.__HMR_FRAMEWORK__="${framework}";</script>` +
			`<script data-hmr-client>${hmrClientBundle}</script>`;
		const bodyClose = /<\/body\s*>/i.exec(html);
		html = bodyClose
			? html.slice(0, bodyClose.index) + tag + html.slice(bodyClose.index)
			: html + tag;
		writeFileSync(filePath, html);
	};

	if (htmlDir && htmlPagesPath) {
		const outputHtmlPages = isSingle
			? join(buildPath, 'pages')
			: join(buildPath, basename(htmlDir), 'pages');

		if (shouldCopyHtml) {
			mkdirSync(outputHtmlPages, { recursive: true });
			cpSync(htmlPagesPath, outputHtmlPages, {
				force: true,
				recursive: true
			});
		}

		// Update asset paths if HTML files changed OR CSS changed
		if (shouldUpdateHtmlAssetPaths) {
			await updateAssetPaths(manifest, outputHtmlPages);
		}

		// Add HTML pages to manifest (absolute paths for Bun.file())
		const htmlPageFiles = await scanEntryPoints(outputHtmlPages, '*.html');
		for (const htmlFile of htmlPageFiles) {
			if (isDev) injectHMRIntoHTMLFile(htmlFile, 'html');
			const fileName = basename(htmlFile, '.html');
			manifest[fileName] = htmlFile;
		}
	}

	if (htmxDir && htmxPagesPath) {
		const outputHtmxPages = isSingle
			? join(buildPath, 'pages')
			: join(buildPath, basename(htmxDir), 'pages');

		if (shouldCopyHtmx) {
			mkdirSync(outputHtmxPages, { recursive: true });
			cpSync(htmxPagesPath, outputHtmxPages, {
				force: true,
				recursive: true
			});
		}

		if (shouldCopyHtmx) {
			const htmxDestDir = isSingle
				? buildPath
				: join(buildPath, basename(htmxDir));

			mkdirSync(htmxDestDir, { recursive: true });

			const glob = new Glob('htmx*.min.js');
			for (const relPath of glob.scanSync({ cwd: htmxDir })) {
				const src = join(htmxDir, relPath);
				const dest = join(htmxDestDir, 'htmx.min.js');
				copyFileSync(src, dest);
				break;
			}
		}

		// Update asset paths if HTMX files changed OR CSS changed
		if (shouldUpdateHtmxAssetPaths) {
			await updateAssetPaths(manifest, outputHtmxPages);
		}

		// Add HTMX pages to manifest (absolute paths for Bun.file())
		const htmxPageFiles = await scanEntryPoints(outputHtmxPages, '*.html');
		for (const htmxFile of htmxPageFiles) {
			if (isDev) injectHMRIntoHTMLFile(htmxFile, 'htmx');
			const fileName = basename(htmxFile, '.html');
			manifest[fileName] = htmxFile;
		}
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
