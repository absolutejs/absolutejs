import {
	copyFileSync,
	cpSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { cwd, env, exit } from 'node:process';
import { $, build as bunBuild, BuildArtifact, Glob } from 'bun';
import type { compileAngular } from '../build/compileAngular';
import type { compileSvelte } from '../build/compileSvelte';
import type { compileVue } from '../build/compileVue';
import { generateManifest } from '../build/generateManifest';
import { generateReactIndexFiles } from '../build/generateReactIndexes';
import { createHTMLScriptHMRPlugin } from '../build/htmlScriptHMRPlugin';
import { outputLogs } from '../build/outputLogs';
import { scanEntryPoints } from '../build/scanEntryPoints';
import { scanCssEntryPoints } from '../build/scanCssEntryPoints';
import { updateAssetPaths } from '../build/updateAssetPaths';
import { buildHMRClient } from '../dev/buildHMRClient';
import { rewriteReactImports } from '../build/rewriteReactImports';
import { sendTelemetryEvent } from '../cli/telemetryEvent';
import { getDevVendorPaths, getAngularVendorPaths } from './devVendorPaths';
import type { BuildConfig } from '../../types/build';
import { angularLinkerPlugin } from '../build/angularLinkerPlugin';
import { cleanStaleOutputs } from '../utils/cleanStaleOutputs';
import { cleanup } from '../utils/cleanup';
import { commonAncestor } from '../utils/commonAncestor';
import { getDurationString } from '../utils/getDurationString';
import { logger } from '../utils/logger';
import { normalizePath } from '../utils/normalizePath';
import { toPascal } from '../utils/stringModifiers';
import { validateSafePath } from '../utils/validateSafePath';

const isDev = env.NODE_ENV === 'development';

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
	stylesConfig,
	tailwind,
	options,
	incrementalFiles,
	mode
}: BuildConfig) => {
	const buildStart = performance.now();
	const projectRoot = cwd();

	// Set version for the startup banner (same resolution as devBuild)
	const versionCandidates = [
		resolve(import.meta.dir, '..', '..', 'package.json'),
		resolve(import.meta.dir, '..', 'package.json')
	];
	for (const candidate of versionCandidates) {
		try {
			const pkg = await Bun.file(candidate).json();
			if (pkg.name === '@absolutejs/absolute') {
				(globalThis as Record<string, unknown>).__absoluteVersion =
					pkg.version;
				break;
			}
		} catch {
			/* try next candidate */
		}
	}
	const isIncremental = incrementalFiles && incrementalFiles.length > 0;

	// Normalize incrementalFiles for consistent cross-platform path checking
	const normalizedIncrementalFiles = incrementalFiles?.map(normalizePath);

	const throwOnError = options?.throwOnError === true;
	const hmr = options?.injectHMR === true;
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
	const stylesPath =
		typeof stylesConfig === 'string' ? stylesConfig : stylesConfig?.path;
	const stylesIgnore =
		typeof stylesConfig === 'object' ? stylesConfig.ignore : undefined;
	const stylesDir =
		stylesPath && validateSafePath(stylesPath, projectRoot);

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

	const frameworkNames = [
		reactDir && 'react',
		htmlDir && 'html',
		htmxDir && 'htmx',
		svelteDir && 'svelte',
		vueDir && 'vue',
		angularDir && 'angular'
	].filter(Boolean);
	sendTelemetryEvent('build:start', {
		framework: frameworkNames[0],
		frameworks: frameworkNames,
		tailwind: !!tailwind,
		mode: mode ?? (isDev ? 'development' : 'production')
	});

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

	const serverFrameworkDirs = [svelteDir, vueDir].filter(
		(dir): dir is string => Boolean(dir)
	);

	let serverOutDir: string | undefined;
	let serverRoot: string | undefined;

	if (serverFrameworkDirs.length === 1) {
		serverRoot = join(serverFrameworkDirs[0]!, 'server');
		serverOutDir = join(buildPath, basename(serverFrameworkDirs[0]!));
	} else if (serverFrameworkDirs.length > 1) {
		// Use framework dirs (not server/ subdirs) as input to
		// commonAncestor — the server/ suffix would cause a false
		// match at the trailing segment due to how filter works.
		serverRoot = commonAncestor(serverFrameworkDirs, projectRoot);
		serverOutDir = buildPath;
	}

	const publicPath =
		publicDirectory && validateSafePath(publicDirectory, projectRoot);

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
		await generateReactIndexFiles(reactPagesPath, reactIndexesPath, hmr);
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

	// Tailwind + entry point scanning run in parallel (they're independent)
	const tailwindPromise =
		tailwind &&
			(!isIncremental ||
				normalizedIncrementalFiles?.some((f) => f.endsWith('.css')))
			? $`bunx @tailwindcss/cli -i ${tailwind.input} -o ${join(buildPath, tailwind.output)}`
			: undefined;

	const [
		,
		allReactEntries,
		allHtmlEntries,
		allSvelteEntries,
		allVueEntries,
		allAngularEntries,
		allGlobalCssEntries
	] = await Promise.all([
		tailwindPromise,
		reactIndexesPath ? scanEntryPoints(reactIndexesPath, '*.tsx') : [],
		htmlScriptsPath ? scanEntryPoints(htmlScriptsPath, '*.{js,ts}') : [],
		sveltePagesPath ? scanEntryPoints(sveltePagesPath, '*.svelte') : [],
		vuePagesPath ? scanEntryPoints(vuePagesPath, '*.vue') : [],
		angularPagesPath ? scanEntryPoints(angularPagesPath, '*.ts') : [],
		stylesDir ? scanCssEntryPoints(stylesDir, stylesIgnore) : []
	]);
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
	const globalCssEntries = isIncremental
		? filterToIncrementalEntries(allGlobalCssEntries, (entry) => entry)
		: allGlobalCssEntries;

	// Start HMR client build early — it has no dependency on compile/bunBuild
	// results and will resolve during the compile phase for free.
	const hmrClientBundlePromise =
		hmr && (htmlDir || htmxDir) ? buildHMRClient() : undefined;

	// Angular HMR Optimization — Skip Svelte/Vue compilation when their entries are
	// empty during incremental builds (avoids importing/initializing unused compilers)
	const shouldCompileSvelte = svelteDir && svelteEntries.length > 0;
	const shouldCompileVue = vueDir && vueEntries.length > 0;
	const shouldCompileAngular = angularDir && angularEntries.length > 0;

	const [
		{ svelteServerPaths, svelteIndexPaths, svelteClientPaths },
		{ vueServerPaths, vueIndexPaths, vueClientPaths, vueCssPaths },
		{ clientPaths: angularClientPaths, serverPaths: angularServerPaths }
	] = await Promise.all([
		shouldCompileSvelte
			? import('../build/compileSvelte').then(
				(mod) =>
					mod.compileSvelte(
						svelteEntries,
						svelteDir!,
						new Map(),
						hmr
					) as ReturnType<typeof compileSvelte>
			)
			: {
				svelteClientPaths: [] as string[],
				svelteIndexPaths: [] as string[],
				svelteServerPaths: [] as string[]
			},
		shouldCompileVue
			? import('../build/compileVue').then(
				(mod) =>
					mod.compileVue(vueEntries, vueDir!, hmr) as ReturnType<
						typeof compileVue
					>
			)
			: {
				vueClientPaths: [] as string[],
				vueCssPaths: [] as string[],
				vueIndexPaths: [] as string[],
				vueServerPaths: [] as string[]
			},
		shouldCompileAngular
			? import('../build/compileAngular').then(
				(mod) =>
					mod.compileAngular(
						angularEntries,
						angularDir!,
						hmr
					) as ReturnType<typeof compileAngular>
			)
			: { clientPaths: [] as string[], serverPaths: [] as string[] }
	]);

	const serverEntryPoints = [...svelteServerPaths, ...vueServerPaths];
	const reactClientEntryPoints = [...reactEntries];
	const nonReactClientEntryPoints = [
		...svelteIndexPaths,
		...svelteClientPaths,
		...htmlEntries,
		...vueIndexPaths,
		...vueClientPaths,
		...angularClientPaths
	];

	if (
		serverEntryPoints.length === 0 &&
		reactClientEntryPoints.length === 0 &&
		nonReactClientEntryPoints.length === 0 &&
		htmxDir === undefined &&
		htmlDir === undefined
	) {
		logger.warn('No entry points found, manifest will be empty');
		sendTelemetryEvent('build:empty', {
			frameworks: frameworkNames,
			mode: mode ?? (isDev ? 'development' : 'production'),
			incremental: !!isIncremental,
			configuredDirs: {
				react: !!reactDir,
				html: !!htmlDir,
				htmx: !!htmxDir,
				svelte: !!svelteDir,
				vue: !!vueDir,
				angular: !!angularDir
			},
			scannedEntries: {
				react: allReactEntries.length,
				html: allHtmlEntries.length,
				svelte: allSvelteEntries.length,
				vue: allVueEntries.length,
				angular: allAngularEntries.length
			},
			filteredEntries: {
				react: reactEntries.length,
				html: htmlEntries.length,
				svelte: svelteEntries.length,
				vue: vueEntries.length,
				angular: angularEntries.length
			}
		});

		return {};
	}

	// In dev, add the _refresh entry to force React into a shared chunk
	// so HMR can re-import component entries without duplicating React.
	// Only add when React entries exist (i.e. React files actually changed
	// or this is a full build) to avoid producing stale React outputs
	// during non-React incremental rebuilds.
	if (hmr && reactIndexesPath && reactClientEntryPoints.length > 0) {
		const refreshEntry = join(reactIndexesPath, '_refresh.tsx');
		if (!reactClientEntryPoints.includes(refreshEntry)) {
			reactClientEntryPoints.push(refreshEntry);
		}
	}

	// In dev mode, check if vendor paths are set. When set, React is
	// externalized and imports are rewritten to stable vendor file paths
	// after the build. This prevents duplicate React instances during HMR.
	const vendorPaths = getDevVendorPaths();
	const angularVendorPaths = getAngularVendorPaths();

	const htmlScriptPlugin = hmr
		? createHTMLScriptHMRPlugin(htmlDir, htmxDir)
		: undefined;

	// Build React config before parallel execution
	const reactBuildConfig: Record<string, unknown> | undefined =
		reactClientEntryPoints.length > 0
			? (() => {
				const cfg: Record<string, unknown> = {
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

				// When vendor paths are available (dev mode), externalize React so
				// Bun doesn't bundle it. The bare specifiers in the output are
				// rewritten to vendor paths after the build completes.
				if (vendorPaths) {
					cfg.external = Object.keys(vendorPaths);
				}

				// Bun's reactFastRefresh option injects $RefreshReg$/$RefreshSig$
				// calls for React Fast Refresh support in dev
				if (hmr) {
					cfg.reactFastRefresh = true;
				}

				return cfg;
			})()
			: undefined;

	// Remove old hashed indexes before bundling so stale files
	// from previous builds don't accumulate in dist/.
	if (reactDir && reactClientEntryPoints.length > 0) {
		rmSync(join(buildPath, 'react', 'indexes'), {
			force: true,
			recursive: true
		});
	}
	if (angularDir && angularClientPaths.length > 0) {
		rmSync(join(buildPath, 'angular', 'indexes'), {
			force: true,
			recursive: true
		});
	}

	// Run all 4 Bun.build passes in parallel — they write to different
	// directories and have independent entry points.
	const [serverResult, reactClientResult, nonReactClientResult, globalCssResult, vueCssResult] =
		await Promise.all([
			serverEntryPoints.length > 0
				? bunBuild({
					entrypoints: serverEntryPoints,
					external: ['svelte', 'svelte/*', 'vue', 'vue/*'],
					format: 'esm',
					naming: `[dir]/[name].[hash].[ext]`,
					outdir: serverOutDir,
					root: serverRoot,
					target: 'bun',
					throw: false
				})
				: undefined,
			reactBuildConfig
				? bunBuild(
					reactBuildConfig as unknown as Parameters<
						typeof bunBuild
					>[0]
				)
				: undefined,
			nonReactClientEntryPoints.length > 0
				? bunBuild({
					define: vueDirectory ? vueFeatureFlags : undefined,
					entrypoints: nonReactClientEntryPoints,
					...(angularVendorPaths
						? { external: Object.keys(angularVendorPaths) }
						: {}),
					format: 'esm',
					minify: !isDev,
					naming: `[dir]/[name].[hash].[ext]`,
					outdir: buildPath,
					plugins: [
						...(angularDir && !isDev
							? [angularLinkerPlugin]
							: []),
						...(htmlScriptPlugin ? [htmlScriptPlugin] : [])
					],
					root: clientRoot,
					target: 'browser',
					splitting: !isDev,
					throw: false
				})
				: undefined,
			globalCssEntries.length > 0
				? bunBuild({
					entrypoints: globalCssEntries,
					naming: `[dir]/[name].[hash].[ext]`,
					outdir: stylesDir ? join(buildPath, basename(stylesDir)) : buildPath,
					root: stylesDir || clientRoot,
					target: 'browser',
					throw: false
				})
				: undefined,
			vueCssPaths.length > 0
				? bunBuild({
					entrypoints: vueCssPaths,
					naming: `[name].[hash].[ext]`,
					outdir: join(
						buildPath,
						assetsPath ? basename(assetsPath) : 'assets',
						'css'
					),
					target: 'browser',
					throw: false
				})
				: undefined
		]);

	// Check each build result for errors
	let serverLogs: (BuildMessage | ResolveMessage)[] = [];
	let serverOutputs: BuildArtifact[] = [];

	if (serverResult) {
		serverLogs = serverResult.logs;
		serverOutputs = serverResult.outputs;
		if (!serverResult.success && serverResult.logs.length > 0) {
			const errLog =
				serverResult.logs.find((l) => l.level === 'error') ??
				serverResult.logs[0]!;
			const err = new Error(
				typeof errLog.message === 'string'
					? errLog.message
					: String(errLog.message)
			);
			(err as Error & { logs?: unknown }).logs = serverResult.logs;
			sendTelemetryEvent('build:error', {
				pass: 'server',
				frameworks: frameworkNames,
				message: err.message,
				incremental: !!isIncremental
			});
			logger.error('Server build failed', err);
			if (throwOnError) throw err;
			exit(1);
		}
	}

	let reactClientLogs: (BuildMessage | ResolveMessage)[] = [];
	let reactClientOutputs: BuildArtifact[] = [];

	if (reactClientResult) {
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
			sendTelemetryEvent('build:error', {
				pass: 'react-client',
				frameworks: frameworkNames,
				message: err.message,
				incremental: !!isIncremental
			});
			logger.error('React client build failed', err);
			if (throwOnError) throw err;
			exit(1);
		}

		// Post-process: rewrite bare React specifiers to vendor paths.
		// Bun outputs `from "react"` for externals — browsers can't resolve
		// bare specifiers, so we rewrite them to `/vendor/react.js` etc.
		if (vendorPaths) {
			await rewriteReactImports(
				reactClientOutputs.map((artifact) => artifact.path),
				vendorPaths
			);
		}
	}

	let nonReactClientLogs: (BuildMessage | ResolveMessage)[] = [];
	let nonReactClientOutputs: BuildArtifact[] = [];

	if (nonReactClientResult) {
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
			sendTelemetryEvent('build:error', {
				pass: 'non-react-client',
				frameworks: frameworkNames,
				message: err.message,
				incremental: !!isIncremental
			});
			logger.error('Non-React client build failed', err);
			if (throwOnError) throw err;
			exit(1);
		}
	}

	// Post-process: rewrite bare Angular specifiers to vendor paths.
	if (angularVendorPaths && nonReactClientOutputs.length > 0) {
		const { rewriteImports } = await import('../build/rewriteImports');
		await rewriteImports(
			nonReactClientOutputs.map((artifact) => artifact.path),
			angularVendorPaths
		);
	}

	let cssLogs: (BuildMessage | ResolveMessage)[] = [];
	let cssOutputs: BuildArtifact[] = [];

	if (globalCssResult) {
		cssLogs.push(...globalCssResult.logs);
		cssOutputs.push(...globalCssResult.outputs);
		if (!globalCssResult.success && globalCssResult.logs.length > 0) {
			const errLog =
				globalCssResult.logs.find((l) => l.level === 'error') ??
				globalCssResult.logs[0]!;
			const err = new Error(
				typeof errLog.message === 'string'
					? errLog.message
					: String(errLog.message)
			);
			(err as Error & { logs?: unknown }).logs = globalCssResult.logs;
			sendTelemetryEvent('build:error', {
				pass: 'global-css',
				frameworks: frameworkNames,
				message: err.message,
				incremental: !!isIncremental
			});
			logger.error('Global CSS build failed', err);
			if (throwOnError) throw err;
			exit(1);
		}
	}

	if (vueCssResult) {
		cssLogs.push(...vueCssResult.logs);
		cssOutputs.push(...vueCssResult.outputs);
		if (!vueCssResult.success && vueCssResult.logs.length > 0) {
			const errLog =
				vueCssResult.logs.find((l) => l.level === 'error') ??
				vueCssResult.logs[0]!;
			const err = new Error(
				typeof errLog.message === 'string'
					? errLog.message
					: String(errLog.message)
			);
			(err as Error & { logs?: unknown }).logs = vueCssResult.logs;
			sendTelemetryEvent('build:error', {
				pass: 'vue-css',
				frameworks: frameworkNames,
				message: err.message,
				incremental: !!isIncremental
			});
			logger.error('Vue CSS build failed', err);
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

	const manifest = {
		...(options?.baseManifest || {}),
		...generateManifest(
			[
				...serverOutputs,
				...reactClientOutputs,
				...nonReactClientOutputs,
				...cssOutputs
			],
			buildPath
		)
	};

	// Svelte/Vue server pages need absolute file paths for SSR import(),
	// not web-relative paths. Overwrite with absolute paths like HTML/HTMX.
	for (const artifact of serverOutputs) {
		const fileWithHash = basename(artifact.path);
		const [baseName] = fileWithHash.split(`.${artifact.hash}.`);
		if (!baseName) continue;
		manifest[toPascal(baseName)] = artifact.path;
	}

	// Angular server pages need absolute file paths for SSR import(),
	// same pattern as Svelte/Vue above.
	for (const serverPath of angularServerPaths) {
		const fileBase = basename(serverPath, '.js');
		manifest[toPascal(fileBase)] = resolve(serverPath);
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

	// Await the HMR client bundle that was started before the compile phase
	const hmrClientBundle = hmrClientBundlePromise
		? await hmrClientBundlePromise
		: null;

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

	// HTML + HTMX post-processing run in parallel (independent directories)
	await Promise.all([
		(async () => {
			if (!(htmlDir && htmlPagesPath)) return;
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
			const htmlPageFiles = await scanEntryPoints(
				outputHtmlPages,
				'*.html'
			);
			for (const htmlFile of htmlPageFiles) {
				if (hmr) injectHMRIntoHTMLFile(htmlFile, 'html');
				const fileName = basename(htmlFile, '.html');
				manifest[fileName] = htmlFile;
			}
		})(),
		(async () => {
			if (!(htmxDir && htmxPagesPath)) return;
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
			const htmxPageFiles = await scanEntryPoints(
				outputHtmxPages,
				'*.html'
			);
			for (const htmxFile of htmxPageFiles) {
				if (hmr) injectHMRIntoHTMLFile(htmxFile, 'htmx');
				const fileName = basename(htmxFile, '.html');
				manifest[fileName] = htmxFile;
			}
		})()
	]);

	if (!isIncremental) {
		await cleanStaleOutputs(buildPath, [
			...serverOutputs.map((a) => a.path),
			...reactClientOutputs.map((a) => a.path),
			...nonReactClientOutputs.map((a) => a.path),
			...cssOutputs.map((a) => a.path)
		]);
	}

	// Skip cleanup during incremental builds — removing compiled/ intermediates
	// adds I/O latency and they'll just get recreated on next rebuild.
	if (!options?.preserveIntermediateFiles && !isIncremental)
		await cleanup({
			angularDir,
			reactIndexesPath,
			svelteDir,
			vueDir
		});

	if (!isIncremental) {
		(globalThis as Record<string, unknown>).__hmrBuildDuration =
			performance.now() - buildStart;
	}

	sendTelemetryEvent('build:complete', {
		frameworks: frameworkNames,
		durationMs: Math.round(performance.now() - buildStart),
		mode: mode ?? (isDev ? 'development' : 'production')
	});

	// Skip manifest.json disk write during incremental (HMR) builds —
	// the in-memory manifest is authoritative and writing to disk on
	// every keystroke adds unnecessary I/O latency.
	if (!isIncremental) {
		writeFileSync(
			join(buildPath, 'manifest.json'),
			JSON.stringify(manifest, null, '\t')
		);
	}

	return manifest;
};
