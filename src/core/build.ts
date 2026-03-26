import {
	copyFileSync,
	cpSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { cwd, env, exit } from 'node:process';
import { build as bunBuild, BuildArtifact, Glob } from 'bun';
import { generateManifest } from '../build/generateManifest';
import { generateReactIndexFiles } from '../build/generateReactIndexes';
import { createHTMLScriptHMRPlugin } from '../build/htmlScriptHMRPlugin';
import { outputLogs } from '../build/outputLogs';
import { scanEntryPoints } from '../build/scanEntryPoints';
import { scanCssEntryPoints } from '../build/scanCssEntryPoints';
import { updateAssetPaths } from '../build/updateAssetPaths';
import { buildHMRClient } from '../dev/buildHMRClient';
import {
	patchRefreshGlobals,
	rewriteReactImports
} from '../build/rewriteReactImports';
import { sendTelemetryEvent } from '../cli/telemetryEvent';
import {
	getAngularVendorPaths,
	getDevVendorPaths,
	getSvelteVendorPaths,
	getVueVendorPaths,
	setAngularVendorPaths,
	setDevVendorPaths,
	setSvelteVendorPaths,
	setVueVendorPaths
} from './devVendorPaths';
import type { BuildConfig } from '../../types/build';
import { angularLinkerPlugin } from '../build/angularLinkerPlugin';
import { cleanStaleOutputs } from '../utils/cleanStaleOutputs';
import { cleanup } from '../utils/cleanup';
import { commonAncestor } from '../utils/commonAncestor';
import { logError, logWarn } from '../utils/logger';
import { normalizePath } from '../utils/normalizePath';
import { toPascal } from '../utils/stringModifiers';
import { validateSafePath } from '../utils/validateSafePath';

const isDev = env.NODE_ENV === 'development';

const extractBuildError = (
	logs: (BuildMessage | ResolveMessage)[],
	pass: string,
	label: string,
	frameworkNames: string[],
	isIncremental: boolean | 0 | undefined,
	throwOnError: boolean
) => {
	const errLog = logs.find((log) => log.level === 'error') ?? logs[0];
	if (!errLog) {
		exit(1);

		return;
	}
	const err = new Error(
		typeof errLog.message === 'string'
			? errLog.message
			: String(errLog.message)
	);
	Object.assign(err, { logs });
	sendTelemetryEvent('build:error', {
		frameworks: frameworkNames,
		incremental: Boolean(isIncremental),
		message: err.message,
		pass
	});
	logError(`${label} build failed`, err);
	if (throwOnError) throw err;
	exit(1);
};

const copyHtmxVendor = (htmxDir: string, htmxDestDir: string) => {
	mkdirSync(htmxDestDir, { recursive: true });
	const glob = new Glob('htmx*.min.js');
	for (const relPath of glob.scanSync({ cwd: htmxDir })) {
		const src = join(htmxDir, relPath);
		const dest = join(htmxDestDir, 'htmx.min.js');
		copyFileSync(src, dest);

		return;
	}
};

const tryReadPackageJson = async (path: string) => {
	try {
		return await Bun.file(path).json();
	} catch {
		return null;
	}
};

const resolveAbsoluteVersion = async () => {
	const candidates = [
		resolve(import.meta.dir, '..', '..', 'package.json'),
		resolve(import.meta.dir, '..', 'package.json')
	];
	for (const candidate of candidates) {
		// eslint-disable-next-line no-await-in-loop -- iterations depend on each other (short-circuits on first match)
		const pkg = await tryReadPackageJson(candidate);
		if (!pkg) continue;
		if (pkg.name !== '@absolutejs/absolute') continue;
		globalThis.__absoluteVersion = pkg.version;

		return;
	}
};

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

	await resolveAbsoluteVersion();
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
	const stylesDir = stylesPath && validateSafePath(stylesPath, projectRoot);

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
	].filter((name): name is string => Boolean(name));
	sendTelemetryEvent('build:start', {
		framework: frameworkNames[0],
		frameworks: frameworkNames,
		mode: mode ?? (isDev ? 'development' : 'production'),
		tailwind: Boolean(tailwind)
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

	const serverDirMap: { dir: string; subdir: string }[] = [];
	if (svelteDir) serverDirMap.push({ dir: svelteDir, subdir: 'server' });
	if (vueDir) serverDirMap.push({ dir: vueDir, subdir: 'server' });
	if (angularDir) serverDirMap.push({ dir: angularDir, subdir: 'compiled' });

	let serverOutDir: string | undefined;
	let serverRoot: string | undefined;

	if (serverDirMap.length === 1) {
		const [firstEntry] = serverDirMap;
		if (!firstEntry)
			throw new Error('Expected at least one server directory entry');
		serverRoot = join(firstEntry.dir, firstEntry.subdir);
		serverOutDir = join(buildPath, basename(firstEntry.dir));
	} else if (serverDirMap.length > 1) {
		// Use framework dirs (not server/compiled subdirs) as input to
		// commonAncestor — the subdirectory suffix would cause a false
		// match at the trailing segment due to how filter works.
		serverRoot = commonAncestor(
			serverDirMap.map((entry) => entry.dir),
			projectRoot
		);
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
			if (!sourceFile) continue;
			if (!normalizedIncremental.has(resolve(sourceFile))) continue;
			matchingEntries.push(entry);
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
			? (async () => {
					let binPath: string;
					try {
						binPath = import.meta.resolve(
							'@tailwindcss/cli/dist/index.mjs'
						);
						if (binPath.startsWith('file://'))
							binPath = binPath.slice(7);
					} catch {
						binPath = 'tailwindcss';
					}
					const proc = Bun.spawn(
						[
							'bun',
							binPath,
							'-i',
							tailwind.input,
							'-o',
							join(buildPath, tailwind.output)
						],
						{ stdout: 'pipe', stderr: 'pipe' }
					);
					await proc.exited;
				})()
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

	const emptyStringArray: string[] = [];

	const [
		{ svelteServerPaths, svelteIndexPaths, svelteClientPaths },
		{ vueServerPaths, vueIndexPaths, vueClientPaths, vueCssPaths },
		{ clientPaths: angularClientPaths, serverPaths: angularServerPaths }
	] = await Promise.all([
		shouldCompileSvelte
			? import('../build/compileSvelte').then((mod) =>
					mod.compileSvelte(svelteEntries, svelteDir, new Map(), hmr)
				)
			: {
					svelteClientPaths: [...emptyStringArray],
					svelteIndexPaths: [...emptyStringArray],
					svelteServerPaths: [...emptyStringArray]
				},
		shouldCompileVue
			? import('../build/compileVue').then((mod) =>
					mod.compileVue(vueEntries, vueDir, hmr)
				)
			: {
					vueClientPaths: [...emptyStringArray],
					vueCssPaths: [...emptyStringArray],
					vueIndexPaths: [...emptyStringArray],
					vueServerPaths: [...emptyStringArray]
				},
		shouldCompileAngular
			? import('../build/compileAngular').then((mod) =>
					mod.compileAngular(angularEntries, angularDir, hmr)
				)
			: {
					clientPaths: [...emptyStringArray],
					serverPaths: [...emptyStringArray]
				}
	]);

	const serverEntryPoints = [
		...svelteServerPaths,
		...vueServerPaths,
		...angularServerPaths
	];
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
		logWarn('No entry points found, manifest will be empty');
		sendTelemetryEvent('build:empty', {
			configuredDirs: {
				angular: Boolean(angularDir),
				html: Boolean(htmlDir),
				htmx: Boolean(htmxDir),
				react: Boolean(reactDir),
				svelte: Boolean(svelteDir),
				vue: Boolean(vueDir)
			},
			filteredEntries: {
				angular: angularEntries.length,
				html: htmlEntries.length,
				react: reactEntries.length,
				svelte: svelteEntries.length,
				vue: vueEntries.length
			},
			frameworks: frameworkNames,
			incremental: Boolean(isIncremental),
			mode: mode ?? (isDev ? 'development' : 'production'),
			scannedEntries: {
				angular: allAngularEntries.length,
				html: allHtmlEntries.length,
				react: allReactEntries.length,
				svelte: allSvelteEntries.length,
				vue: allVueEntries.length
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
		if (!reactClientEntryPoints.includes(refreshEntry))
			reactClientEntryPoints.push(refreshEntry);
	}

	// In dev mode, externalize React so imports get rewritten to stable
	// vendor file paths. If module-level state was lost (Bun --hot
	// re-evaluated devVendorPaths.ts), recompute and restore it.
	let vendorPaths = getDevVendorPaths();
	if (!vendorPaths && hmr && reactDir) {
		const { computeVendorPaths } = await import(
			'../build/buildReactVendor'
		);
		vendorPaths = computeVendorPaths();
		setDevVendorPaths(vendorPaths);
	}
	let angularVendorPaths = getAngularVendorPaths();
	if (!angularVendorPaths && hmr && angularDir) {
		const { computeAngularVendorPaths } = await import(
			'../build/buildAngularVendor'
		);
		angularVendorPaths = computeAngularVendorPaths();
		setAngularVendorPaths(angularVendorPaths);
	}
	let vueVendorPaths = getVueVendorPaths();
	if (!vueVendorPaths && hmr && vueDir) {
		const { computeVueVendorPaths } = await import(
			'../build/buildVueVendor'
		);
		vueVendorPaths = computeVueVendorPaths();
		setVueVendorPaths(vueVendorPaths);
	}
	let svelteVendorPaths = getSvelteVendorPaths();
	if (!svelteVendorPaths && hmr && svelteDir) {
		const { computeSvelteVendorPaths } = await import(
			'../build/buildSvelteVendor'
		);
		svelteVendorPaths = computeSvelteVendorPaths();
		setSvelteVendorPaths(svelteVendorPaths);
	}

	const htmlScriptPlugin = hmr
		? createHTMLScriptHMRPlugin(htmlDir, htmxDir)
		: undefined;

	const reactBuildConfig: Parameters<typeof bunBuild>[0] | undefined =
		reactClientEntryPoints.length > 0
			? {
					entrypoints: reactClientEntryPoints,
					...(vendorPaths
						? { external: Object.keys(vendorPaths) }
						: {}),
					format: 'esm',
					minify: !isDev,
					naming: `[dir]/[name].[hash].[ext]`,
					outdir: buildPath,
					...(hmr
						? { jsx: { development: true }, reactFastRefresh: true }
						: {}),
					root: clientRoot,
					splitting: true,
					target: 'browser',
					throw: false
				}
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
	const [
		serverResult,
		reactClientResult,
		nonReactClientResult,
		globalCssResult,
		vueCssResult
	] = await Promise.all([
		serverEntryPoints.length > 0
			? bunBuild({
					entrypoints: serverEntryPoints,
					external: [
						'svelte',
						'svelte/*',
						'vue',
						'vue/*',
						'@angular/core',
						'@angular/core/*',
						'@angular/common',
						'@angular/common/*',
						'@angular/compiler',
						'@angular/compiler/*',
						'@angular/platform-browser',
						'@angular/platform-browser/*',
						'@angular/platform-server',
						'@angular/platform-server/*'
					],
					format: 'esm',
					naming: `[dir]/[name].[hash].[ext]`,
					outdir: serverOutDir,
					root: serverRoot,
					target: 'bun',
					throw: false
				})
			: undefined,
		reactBuildConfig ? bunBuild(reactBuildConfig) : undefined,
		nonReactClientEntryPoints.length > 0
			? bunBuild({
					define: vueDirectory ? vueFeatureFlags : undefined,
					entrypoints: nonReactClientEntryPoints,
					external: [
						...Object.keys(angularVendorPaths ?? {}),
						...Object.keys(vueVendorPaths ?? {}),
						...Object.keys(svelteVendorPaths ?? {})
					],
					format: 'esm',
					minify: !isDev,
					naming: `[dir]/[name].[hash].[ext]`,
					outdir: buildPath,
					plugins: [
						...(angularDir && !isDev ? [angularLinkerPlugin] : []),
						...(htmlScriptPlugin ? [htmlScriptPlugin] : [])
					],
					root: clientRoot,
					splitting: !isDev,
					target: 'browser',
					throw: false
				})
			: undefined,
		globalCssEntries.length > 0
			? bunBuild({
					entrypoints: globalCssEntries,
					naming: `[dir]/[name].[hash].[ext]`,
					outdir: stylesDir
						? join(buildPath, basename(stylesDir))
						: buildPath,
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

	const serverLogs = serverResult?.logs ?? [];
	const serverOutputs = serverResult?.outputs ?? [];

	if (serverResult && !serverResult.success && serverLogs.length > 0) {
		extractBuildError(
			serverLogs,
			'server',
			'Server',
			frameworkNames,
			isIncremental,
			throwOnError
		);
	}

	const reactClientLogs = reactClientResult?.logs ?? [];
	const reactClientOutputs = reactClientResult?.outputs ?? [];

	// Strip Bun's $RefreshReg$ no-op fallback from React build outputs.
	// Bun.build injects `window.$RefreshReg$||(window.$RefreshReg$=function(){})`
	// at the top of each entry point. This runs BEFORE chunk imports, so
	// chunks register with the no-op instead of the real React Refresh
	// runtime. The real runtime is set up by reactRefreshSetup.ts (imported
	// in the index preamble), but ESM import hoisting means chunks evaluate
	// before the preamble body runs. Stripping the fallback lets the
	// chunks use the real runtime that was already set on window by the
	// setup module (which is a dependency, evaluated first).
	if (hmr && reactClientOutputs.length > 0) {
		const REFRESH_NOOP_RE =
			/window\.\$RefreshReg\$\|\|\(window\.\$RefreshReg\$=function\(\)\{\}\);window\.\$RefreshSig\$\|\|\(window\.\$RefreshSig\$=function\(\)\{return function\(t\)\{return t\}\}\);?\n?/g;
		for (const output of reactClientOutputs) {
			if (output.kind !== 'entry-point') continue;
			try {
				const content = await Bun.file(output.path).text();
				if (REFRESH_NOOP_RE.test(content)) {
					REFRESH_NOOP_RE.lastIndex = 0;
					const stripped = content.replace(REFRESH_NOOP_RE, '');
					writeFileSync(output.path, stripped);
				}
			} catch {
				// skip if file can't be read
			}
		}
	}

	if (
		reactClientResult &&
		!reactClientResult.success &&
		reactClientLogs.length > 0
	) {
		extractBuildError(
			reactClientLogs,
			'react-client',
			'React client',
			frameworkNames,
			isIncremental,
			throwOnError
		);
	}

	const reactClientOutputPaths = reactClientOutputs.map(
		(artifact) => artifact.path
	);

	if (vendorPaths && reactClientOutputPaths.length > 0) {
		await rewriteReactImports(reactClientOutputPaths, vendorPaths);
	}

	if (hmr && reactClientOutputPaths.length > 0) {
		await patchRefreshGlobals(reactClientOutputPaths);
	}

	const nonReactClientLogs = nonReactClientResult?.logs ?? [];
	const nonReactClientOutputs = nonReactClientResult?.outputs ?? [];

	if (
		nonReactClientResult &&
		!nonReactClientResult.success &&
		nonReactClientLogs.length > 0
	) {
		extractBuildError(
			nonReactClientLogs,
			'non-react-client',
			'Non-React client',
			frameworkNames,
			isIncremental,
			throwOnError
		);
	}

	// Post-process: rewrite bare Angular/Vue specifiers to vendor paths.
	if (nonReactClientOutputs.length > 0) {
		const allNonReactVendorPaths = {
			...(angularVendorPaths ?? {}),
			...(vueVendorPaths ?? {}),
			...(svelteVendorPaths ?? {})
		};
		if (Object.keys(allNonReactVendorPaths).length > 0) {
			const { rewriteImports } = await import('../build/rewriteImports');
			await rewriteImports(
				nonReactClientOutputs.map((artifact) => artifact.path),
				allNonReactVendorPaths
			);
		}
	}

	const cssLogs: (BuildMessage | ResolveMessage)[] = [
		...(globalCssResult?.logs ?? []),
		...(vueCssResult?.logs ?? [])
	];
	const cssOutputs: BuildArtifact[] = [
		...(globalCssResult?.outputs ?? []),
		...(vueCssResult?.outputs ?? [])
	];

	if (
		globalCssResult &&
		!globalCssResult.success &&
		globalCssResult.logs.length > 0
	) {
		extractBuildError(
			globalCssResult.logs,
			'global-css',
			'Global CSS',
			frameworkNames,
			isIncremental,
			throwOnError
		);
	}

	if (vueCssResult && !vueCssResult.success && vueCssResult.logs.length > 0) {
		extractBuildError(
			vueCssResult.logs,
			'vue-css',
			'Vue CSS',
			frameworkNames,
			isIncremental,
			throwOnError
		);
	}

	const allLogs = [
		...serverLogs,
		...reactClientLogs,
		...nonReactClientLogs,
		...cssLogs
	];
	outputLogs(allLogs);

	const manifest: Record<string, string> = {
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

	// Server pages (Svelte, Vue, Angular) need absolute file paths for SSR
	// import(), not web-relative paths. Overwrite with absolute paths.
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
	const processHtmlPages = async () => {
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
		const htmlPageFiles = await scanEntryPoints(outputHtmlPages, '*.html');
		for (const htmlFile of htmlPageFiles) {
			if (hmr) injectHMRIntoHTMLFile(htmlFile, 'html');
			const fileName = basename(htmlFile, '.html');
			manifest[fileName] = htmlFile;
		}
	};

	const processHtmxPages = async () => {
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
			copyHtmxVendor(htmxDir, htmxDestDir);
		}

		// Update asset paths if HTMX files changed OR CSS changed
		if (shouldUpdateHtmxAssetPaths) {
			await updateAssetPaths(manifest, outputHtmxPages);
		}

		// Add HTMX pages to manifest (absolute paths for Bun.file())
		const htmxPageFiles = await scanEntryPoints(outputHtmxPages, '*.html');
		for (const htmxFile of htmxPageFiles) {
			if (hmr) injectHMRIntoHTMLFile(htmxFile, 'htmx');
			const fileName = basename(htmxFile, '.html');
			manifest[fileName] = htmxFile;
		}
	};

	await Promise.all([processHtmlPages(), processHtmxPages()]);

	if (!isIncremental) {
		await cleanStaleOutputs(buildPath, [
			...serverOutputs.map((a) => a.path),
			...reactClientOutputs.map((a) => a.path),
			...nonReactClientOutputs.map((a) => a.path),
			...cssOutputs.map((a) => a.path)
		]);
	}

	// In dev mode, copy source indexes to build dir before cleanup.
	// Rewrite relative page imports to absolute /@src/ paths since
	// the indexes are moved from src/frontend/indexes/ to build/_src_indexes/
	if (hmr && reactIndexesPath && reactPagesPath) {
		const { readdirSync: readDir } = await import('node:fs');
		const devIndexDir = join(buildPath, '_src_indexes');
		mkdirSync(devIndexDir, { recursive: true });

		const indexFiles = readDir(reactIndexesPath).filter((f: string) =>
			f.endsWith('.tsx')
		);
		const pagesRel = relative(
			process.cwd(),
			resolve(reactPagesPath)
		).replace(/\\/g, '/');

		for (const file of indexFiles) {
			let content = readFileSync(join(reactIndexesPath, file), 'utf-8');
			// Rewrite '../pages/ComponentName' to '/@src/src/frontend/pages/ComponentName'
			content = content.replace(
				/from\s*['"]\.\.\/pages\/([^'"]+)['"]/g,
				`from '/@src/${pagesRel}/$1'`
			);
			writeFileSync(join(devIndexDir, file), content);
		}
	}

	if (!options?.preserveIntermediateFiles)
		await cleanup({
			angularDir,
			reactIndexesPath,
			svelteDir,
			vueDir
		});

	if (!isIncremental) {
		globalThis.__hmrBuildDuration = performance.now() - buildStart;
	}

	sendTelemetryEvent('build:complete', {
		durationMs: Math.round(performance.now() - buildStart),
		frameworks: frameworkNames,
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
