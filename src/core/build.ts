import { copyFileSync, cpSync, mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { basename, join, resolve, dirname, relative } from 'node:path';
import { cwd, env, exit } from 'node:process';
import { $, build as bunBuild, BuildArtifact, Glob } from 'bun';
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
	options,
	incrementalFiles
}: BuildConfig) => {
	const buildStart = performance.now();
	const projectRoot = cwd();
	const isIncremental = incrementalFiles && incrementalFiles.length > 0;
	
	if (isIncremental) {
		console.log(`⚡ Incremental build: ${incrementalFiles.length} file(s) to rebuild`);
	}

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

	// Only delete build directory for full builds, not incremental
	if (!isIncremental) {
	await rm(buildPath, { force: true, recursive: true });
	}
	mkdirSync(buildPath, { recursive: true });

	// Helper to find matching entry points for incremental files
	// The dependency graph already includes all dependent files in incrementalFiles
	const filterToIncrementalEntries = (
		entryPoints: string[],
		mapToSource: (entry: string) => string | null
	): string[] => {
		if (!isIncremental || !incrementalFiles) return entryPoints;
		
		const normalizedIncremental = new Set(incrementalFiles.map(f => resolve(f)));
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
		await generateReactIndexFiles(reactPagesPath, reactIndexesPath);
	}

	// Copy assets on full builds or if assets changed
	if (assetsPath && (!isIncremental || incrementalFiles?.some(f => f.includes('/assets/')))) {
		cpSync(assetsPath, join(buildPath, 'assets'), {
			force: true,
			recursive: true
		});
	}

	// Tailwind only on full builds or if CSS changed
	if (tailwind && (!isIncremental || incrementalFiles?.some(f => f.endsWith('.css')))) {
		await $`bunx @tailwindcss/cli -i ${tailwind.input} -o ${join(buildPath, tailwind.output)}`;
	}

	const allReactEntries = reactIndexesPath
		? await scanEntryPoints(reactIndexesPath, '*.tsx')
		: [];
	// CRITICAL: Also build React page components as separate entry points for HMR
	// This allows them to be dynamically imported during hot updates
	const allReactPageEntries = reactPagesPath
		? await scanEntryPoints(reactPagesPath, '*.tsx')
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

	// Filter entries for incremental builds
	// For React: map index entries back to their source pages
	const reactEntries = isIncremental && reactIndexesPath && reactPagesPath
		? filterToIncrementalEntries(allReactEntries, (entry) => {
			// Map index entry (indexes/ReactExample.tsx) to source page (pages/ReactExample.tsx)
			if (entry.startsWith(resolve(reactIndexesPath))) {
				const pageName = basename(entry, '.tsx');
				return join(reactPagesPath, `${pageName}.tsx`);
			}
			return null;
		})
		: allReactEntries;
	
	// Also filter React page entries for incremental builds
	const reactPageEntries = isIncremental && reactPagesPath
		? filterToIncrementalEntries(allReactPageEntries, (entry) => entry)
		: allReactPageEntries;
	
	const htmlEntries = isIncremental && htmlScriptsPath
		? filterToIncrementalEntries(allHtmlEntries, (entry) => {
			// HTML entries are the scripts themselves
			return entry;
		})
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
	const htmlCssEntries = isIncremental
		? filterToIncrementalEntries(allHtmlCssEntries, (entry) => entry)
		: allHtmlCssEntries;
	const htmxCssEntries = isIncremental
		? filterToIncrementalEntries(allHtmxCssEntries, (entry) => entry)
		: allHtmxCssEntries;
	const reactCssEntries = isIncremental
		? filterToIncrementalEntries(allReactCssEntries, (entry) => entry)
		: allReactCssEntries;
	const svelteCssEntries = isIncremental
		? filterToIncrementalEntries(allSvelteCssEntries, (entry) => entry)
		: allSvelteCssEntries;

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
		...reactPageEntries, // Build React pages separately for HMR
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

	if (
		serverEntryPoints.length === 0 &&
		clientEntryPoints.length === 0 &&
		htmxDir === undefined
	) {
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
			target: 'browser',
			splitting: true, // Enable code splitting for React HMR (allows components to be imported separately)
			external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] // Prevent React from being bundled in page components (use window globals)
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

	const newManifest = generateManifest(
		[...serverOutputs, ...clientOutputs, ...cssOutputs],
		buildPath
	);

	// For incremental builds, merge with existing manifest to preserve unchanged entries
	let manifest = newManifest;
	if (isIncremental) {
		// Try to load existing manifest from build directory
		const manifestPath = join(buildPath, 'manifest.json');
		try {
			const manifestFile = Bun.file(manifestPath);
			if (await manifestFile.exists()) {
				const manifestText = await manifestFile.text();
				const existingManifest = JSON.parse(manifestText) as Record<string, string>;
				// Merge: new entries override old ones, but keep old entries for unchanged files
				manifest = { ...existingManifest, ...newManifest };
				console.log(`📋 Merged manifest: ${Object.keys(newManifest).length} new, ${Object.keys(existingManifest).length} existing entries`);
			}
		} catch {
			// No existing manifest or parse error, use new one
			manifest = newManifest;
		}
	}

	// For HTML/HTMX, copy pages on full builds or if HTML/HTMX files changed
	// Also update asset paths if CSS changed (to update CSS links in HTML files)
	const htmlOrHtmlCssChanged = !isIncremental || 
		(incrementalFiles?.some(f => f.includes('/html/') && (f.endsWith('.html') || f.endsWith('.css'))));
	const htmxOrHtmxCssChanged = !isIncremental || 
		(incrementalFiles?.some(f => f.includes('/htmx/') && (f.endsWith('.html') || f.endsWith('.css'))));
	
	const shouldCopyHtml = htmlOrHtmlCssChanged;
	const shouldCopyHtmx = htmxOrHtmxCssChanged;
	
	// Update asset paths if CSS changed (even if HTML files didn't change)
	const shouldUpdateHtmlAssetPaths = !isIncremental || 
		(incrementalFiles?.some(f => f.includes('/html/') && (f.endsWith('.html') || f.endsWith('.css'))));
	const shouldUpdateHtmxAssetPaths = !isIncremental || 
		(incrementalFiles?.some(f => f.includes('/htmx/') && (f.endsWith('.html') || f.endsWith('.css'))));

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
		for (const relativePath of glob.scanSync({ cwd: htmxDir })) {
			const src = join(htmxDir, relativePath);
			const dest = join(htmxDestDir, 'htmx.min.js');
			copyFileSync(src, dest);
			break;
		}
		}
		
		// Update asset paths if HTMX files changed OR CSS changed
		if (shouldUpdateHtmxAssetPaths) {
		await updateAssetPaths(manifest, outputHtmxPages);
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
	
	// Always save manifest for incremental builds (so we can merge on next incremental build)
	const manifestPath = join(buildPath, 'manifest.json');
	const manifestJson = JSON.stringify(manifest, null, 2);
	try {
		await Bun.write(manifestPath, manifestJson);
	} catch (error) {
		console.warn('⚠️ Could not save manifest:', error);
	}

	return manifest;
};
