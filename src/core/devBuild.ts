import { readdir } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from './build';
import {
	getAngularVendorPaths,
	getDevVendorPaths,
	getSvelteVendorPaths,
	getVueVendorPaths,
	setDevVendorPaths,
	setAngularVendorPaths,
	setSvelteVendorPaths,
	setVueVendorPaths
} from './devVendorPaths';
import type { BuildConfig } from '../../types/build';
import {
	buildReactVendor,
	computeVendorPaths
} from '../build/buildReactVendor';
import {
	buildAngularVendor,
	computeAngularVendorPaths,
	computeAngularVendorPathsAsync
} from '../build/buildAngularVendor';
import {
	buildSvelteVendor,
	computeSvelteVendorPaths
} from '../build/buildSvelteVendor';
import { buildVueVendor, computeVueVendorPaths } from '../build/buildVueVendor';
import { createHMRState } from '../dev/clientManager';
import { resolveBuildPaths } from '../dev/configResolver';
import { buildInitialDependencyGraph } from '../dev/dependencyGraph';
import { addFileWatchers, startFileWatching } from '../dev/fileWatcher';
import { getWatchPaths } from '../dev/pathUtils';
import { cleanStaleAssets, populateAssetStore } from '../dev/assetStore';
import { queueFileChange } from '../dev/rebuildTrigger';
import { logServerReload } from '../utils/logger';
import { logStartupTimingBlock } from '../utils/startupTimings';

const FRAMEWORK_DIR_KEYS = [
	'reactDirectory',
	'svelteDirectory',
	'vueDirectory',
	'htmlDirectory',
	'htmxDirectory',
	'angularDirectory'
] as const;

const collectDepVendorSourceDirs = (config: BuildConfig) => {
	const configuredDirs = [
		config.reactDirectory,
		config.svelteDirectory,
		config.vueDirectory,
		config.angularDirectory,
		config.htmlDirectory,
		config.htmxDirectory
	].filter((dir): dir is string => Boolean(dir));

	// Only scan the configured framework directories themselves. Including the
	// parent dir would sweep in sibling backend code (e.g. src/backend when
	// angularDirectory is src/frontend), and the dep vendor build targets the
	// browser — bundling Node-only deps like postgres/firebase-admin from there
	// fails with "Browser build cannot import Node.js builtin: tls/http2/...".
	return Array.from(new Set(configuredDirs));
};

/** Parse directory keys from config source text */
const parseDirectoryConfig = (source: string) => {
	const config: Partial<BuildConfig> = {};
	const dirPattern = /(\w+Directory)\s*:\s*['"]([^'"]+)['"]/g;
	let match;
	while ((match = dirPattern.exec(source)) !== null) {
		const [, key, value] = match;
		if (key && value) Object.assign(config, { [key]: value });
	}

	return Object.keys(config).length > 0 ? config : null;
};

/** Re-read absolute.config.ts bypassing Bun's module cache by parsing the file directly */
const reloadConfig = async () => {
	try {
		const configPath = resolve(
			process.env.ABSOLUTE_CONFIG ?? 'absolute.config.ts'
		);
		const source = await Bun.file(configPath).text();

		return parseDirectoryConfig(source);
	} catch {
		return null;
	}
};

/** Detect config changes on HMR reload and update watchers for new framework directories */
const detectConfigChanges = async (
	cached: NonNullable<typeof globalThis.__hmrDevResult>
) => {
	const newConfig = await reloadConfig();
	if (!newConfig) return;

	const state = cached.hmrState;
	const oldConfig = state.config;

	// Check if any framework directory changed
	const hasChanges = FRAMEWORK_DIR_KEYS.some(
		(key) => newConfig[key] !== oldConfig[key]
	);
	if (!hasChanges) return;

	// Snapshot old watch paths before updating config
	const oldWatchPaths = new Set(
		getWatchPaths(oldConfig, state.resolvedPaths)
	);

	// Update config in-place so all references stay valid
	for (const key of FRAMEWORK_DIR_KEYS) {
		state.config[key] = newConfig[key];
	}
	state.resolvedPaths = resolveBuildPaths(state.config);

	// Set up vendor paths for newly added frameworks
	if (!oldConfig.reactDirectory && Boolean(newConfig.reactDirectory)) {
		setDevVendorPaths(computeVendorPaths());
	}
	if (!oldConfig.angularDirectory && Boolean(newConfig.angularDirectory)) {
		setAngularVendorPaths(computeAngularVendorPaths());
	}
	if (!oldConfig.svelteDirectory && Boolean(newConfig.svelteDirectory)) {
		setSvelteVendorPaths(computeSvelteVendorPaths());
	}
	if (!oldConfig.vueDirectory && Boolean(newConfig.vueDirectory)) {
		setVueVendorPaths(computeVueVendorPaths());
	}

	// Compute new watch paths and start watchers for additions
	const newWatchPaths = getWatchPaths(state.config, state.resolvedPaths);
	const addedPaths = newWatchPaths.filter((path) => !oldWatchPaths.has(path));

	if (addedPaths.length > 0) {
		buildInitialDependencyGraph(state.dependencyGraph, addedPaths);
		addFileWatchers(state, addedPaths, (filePath: string) => {
			queueFileChange(state, filePath, state.config, (newBuildResult) => {
				Object.assign(cached.manifest, newBuildResult.manifest);
				state.manifest = cached.manifest;
			});
		});
	}
};

/** Remove keys from target that don't exist in source */
const removeStaleKeys = (
	target: Record<string, string>,
	source: Record<string, string>
) => {
	for (const key of Object.keys(target)) {
		if (!(key in source)) delete target[key];
	}
};

const REBUILD_POLL_MS = 10;

/** Wait for any in-flight file-watcher build to finish */
const waitForRebuild = async (state: { isRebuilding: boolean }) => {
	if (!state.isRebuilding) {
		return;
	}

	await Bun.sleep(REBUILD_POLL_MS);
	await waitForRebuild(state);
};

/** Rebuild manifest and update asset store — called on every server.ts HMR reload.
 *  Sets isRebuilding to prevent the file-watcher fast path from running concurrently,
 *  which would delete the indexes directory mid-build and cause ModuleNotFound errors. */
const rebuildManifest = async (
	cached: NonNullable<typeof globalThis.__hmrDevResult>
) => {
	const state = cached.hmrState;

	// Without this, a concurrent fast-path build (React, Vue, Svelte) can
	// delete intermediate directories (indexes/, server/) while this full
	// build is trying to read from them, causing ModuleNotFound errors.
	await waitForRebuild(state);

	state.isRebuilding = true;

	try {
		const buildResult = await build({
			...state.config,
			mode: 'development',
			options: {
				...state.config.options,
				injectHMR: true,
				throwOnError: true
			}
		});
		if (!buildResult?.manifest) return;
		const newManifest = buildResult.manifest;

		// Replace manifest contents instead of just merging.
		// Object.assign only adds/updates keys — it never removes them,
		// so deleted pages would leave dead keys in the manifest forever.
		removeStaleKeys(cached.manifest, newManifest);
		Object.assign(cached.manifest, newManifest);
		state.manifest = cached.manifest;

		await populateAssetStore(
			state.assetStore,
			cached.manifest,
			state.resolvedPaths.buildDir
		);
		await cleanStaleAssets(
			state.assetStore,
			cached.manifest,
			state.resolvedPaths.buildDir
		);
	} catch {
		// Build errors are logged by build() itself
	} finally {
		state.rebuildCount++;
		state.isRebuilding = false;
		// Clear any file-change queue entries that accumulated during the full build —
		// the full build already picked up those files, so they don't need rebuilding.
		state.fileChangeQueue.clear();
	}
};

const handleCachedReload = async () => {
	const serverMtime = statSync(resolve(Bun.main)).mtimeMs;
	const lastMtime = globalThis.__hmrServerMtime;
	globalThis.__hmrServerMtime = serverMtime;

	/* Restore vendor paths — module-level state is reset on --hot reload
	   but devBuild() returns early from cache, skipping setDevVendorPaths.
	   Without this, HMR rebuilds bundle React inline instead of externalizing. */
	const cached = globalThis.__hmrDevResult;
	if (cached?.hmrState.config.reactDirectory) {
		setDevVendorPaths(computeVendorPaths());
	}
	if (cached?.hmrState.config.angularDirectory) {
		// Use cached transitive specifiers if available — reverting to defaults
		// would drop subpaths discovered through deps (e.g. @angular/core/rxjs-interop
		// imported by @angular/fire) and leave them as bare specifiers in rebuilds.
		setAngularVendorPaths(
			computeAngularVendorPaths(globalThis.__angularVendorSpecifiers)
		);
	}
	if (cached?.hmrState.config.svelteDirectory) {
		setSvelteVendorPaths(computeSvelteVendorPaths());
	}
	if (cached?.hmrState.config.vueDirectory) {
		setVueVendorPaths(computeVueVendorPaths());
	}

	if (serverMtime === lastMtime) {
		globalThis.__hmrSkipServerRestart = true;

		return;
	}

	logServerReload();
	if (!cached) return;

	// Detect config changes (new framework directories) and update watchers
	await detectConfigChanges(cached);
	// Always rebuild when server.ts changes — new pages/routes may have been added
	// even if config directories haven't changed
	await rebuildManifest(cached);
};

const tryReadPackageVersion = async (path: string) => {
	const pkg = await Bun.file(path)
		.json()
		.catch(() => null);
	if (!pkg || pkg.name !== '@absolutejs/absolute') {
		return false;
	}
	globalThis.__absoluteVersion = pkg.version;

	return true;
};

const resolveAbsoluteVersion = async () => {
	const candidates = [
		resolve(import.meta.dir, '..', '..', 'package.json'),
		resolve(import.meta.dir, '..', 'package.json')
	];
	const [candidate, ...remaining] = candidates;
	if (!candidate) {
		return;
	}

	const found = await tryReadPackageVersion(candidate);
	if (found) {
		return;
	}

	await resolveAbsoluteVersionFromCandidates(remaining);
};

const resolveAbsoluteVersionFromCandidates = async (candidates: string[]) => {
	const [candidate, ...remaining] = candidates;
	if (!candidate) {
		return;
	}

	const found = await tryReadPackageVersion(candidate);
	if (found) {
		return;
	}

	await resolveAbsoluteVersionFromCandidates(remaining);
};

const loadVendorFiles = async (
	assetStore: Map<string, Uint8Array>,
	vendorDir: string,
	framework: string
) => {
	const emptyStringArray: string[] = [];
	const entries = await readdir(vendorDir).catch(() => emptyStringArray);
	await Promise.all(
		entries.map(async (entry) => {
			const webPath = `/${framework}/vendor/${entry}`;
			const bytes = await Bun.file(resolve(vendorDir, entry)).bytes();
			assetStore.set(webPath, bytes);
		})
	);
};

/* Development mode function - replaces build() during development
   Returns DevResult with manifest, buildDir, asset(), and hmrState for use with the hmr() plugin */
export const devBuild = async (config: BuildConfig) => {
	// On Bun --hot reload, return cached result instead of rebuilding
	const cached = globalThis.__hmrDevResult;
	if (cached) {
		await handleCachedReload();

		return cached;
	}

	const startupSteps: Array<{ label: string; durationMs: number }> = [];
	const recordStep = (label: string, startedAt: number) => {
		const durationMs = performance.now() - startedAt;

		startupSteps.push({
			durationMs,
			label
		});
	};

	// Create initial HMR state with config
	let stepStartedAt = performance.now();
	const state = createHMRState(config);
	recordStep('create HMR state', stepStartedAt);

	// Initialize dependency graph by scanning all source files
	stepStartedAt = performance.now();
	const watchPaths = getWatchPaths(config, state.resolvedPaths);
	buildInitialDependencyGraph(state.dependencyGraph, watchPaths);
	recordStep('initialize dependency graph', stepStartedAt);

	// Pre-compute vendor paths so build() can externalize frameworks.
	// The actual vendor files are built after build() creates the output dir.
	stepStartedAt = performance.now();
	if (config.reactDirectory) {
		setDevVendorPaths(computeVendorPaths());
	}
	if (config.svelteDirectory) {
		setSvelteVendorPaths(computeSvelteVendorPaths());
	}
	if (config.vueDirectory) {
		setVueVendorPaths(computeVueVendorPaths());
	}
	const sourceDirs = collectDepVendorSourceDirs(config);
	if (config.angularDirectory) {
		setAngularVendorPaths(await computeAngularVendorPathsAsync(sourceDirs));
	}
	const { computeDepVendorPaths } = await import('../build/buildDepVendor');
	globalThis.__depVendorPaths = await computeDepVendorPaths(sourceDirs);
	recordStep('prepare vendor paths', stepStartedAt);

	stepStartedAt = performance.now();
	await resolveAbsoluteVersion();
	recordStep('resolve version', stepStartedAt);

	const buildStart = performance.now();

	// Initial build (HMR client is baked into index files and HTML/HTMX pages)
	const buildResult = await build({
		...config,
		mode: 'development',
		options: {
			...config.options,
			injectHMR: true
		}
	});
	const manifest = buildResult.manifest ?? {};
	const conventions = buildResult.conventions ?? {};
	recordStep('initial build', buildStart);

	if (Object.keys(manifest).length === 0) {
		console.log(
			'⚠️ Manifest is empty - this is OK for HTML/HTMX-only projects'
		);
	}

	// Populate in-memory asset store so client assets are served from memory
	stepStartedAt = performance.now();
	await populateAssetStore(
		state.assetStore,
		manifest,
		state.resolvedPaths.buildDir
	);
	void cleanStaleAssets(
		state.assetStore,
		manifest,
		state.resolvedPaths.buildDir
	);
	recordStep('populate asset store', stepStartedAt);

	// Build vendor files in parallel now that the build directory exists.
	// Each task only BUILDS — file rewriting + asset-store loading happen below
	// in a centralized post-step so cross-framework specifier rewrites can use
	// the FULL combined path map (react ∪ angular ∪ svelte ∪ vue ∪ dep).
	stepStartedAt = performance.now();
	const reactVendorDir = resolve(
		state.resolvedPaths.buildDir,
		'react',
		'vendor'
	);
	const angularVendorDir = resolve(
		state.resolvedPaths.buildDir,
		'angular',
		'vendor'
	);
	const svelteVendorDir = resolve(
		state.resolvedPaths.buildDir,
		'svelte',
		'vendor'
	);
	const vueVendorDir = resolve(state.resolvedPaths.buildDir, 'vue', 'vendor');
	const depVendorDir = resolve(state.resolvedPaths.buildDir, 'vendor');

	const { buildDepVendor } = await import('../build/buildDepVendor');

	const [, angularSpecs, , , depPaths] = await Promise.all([
		config.reactDirectory
			? buildReactVendor(state.resolvedPaths.buildDir)
			: Promise.resolve(undefined),
		config.angularDirectory
			? buildAngularVendor(
					state.resolvedPaths.buildDir,
					sourceDirs,
					/* linkerJitMode */ true,
					/* depVendorSpecifiers */ Object.keys(
						globalThis.__depVendorPaths ?? {}
					)
				)
			: Promise.resolve(undefined),
		config.svelteDirectory
			? buildSvelteVendor(state.resolvedPaths.buildDir)
			: Promise.resolve(undefined),
		config.vueDirectory
			? buildVueVendor(state.resolvedPaths.buildDir)
			: Promise.resolve(undefined),
		buildDepVendor(state.resolvedPaths.buildDir, sourceDirs)
	]);
	if (angularSpecs) globalThis.__angularVendorSpecifiers = angularSpecs;
	globalThis.__depVendorPaths = depPaths;
	recordStep('build vendor bundles', stepStartedAt);

	// Cross-vendor specifier rewriting: a vendor file may externalize packages
	// owned by a different vendor pipeline (e.g. /vendor/sentry_angular.js
	// externalizes @angular/core; /vendor/firebase_auth_compat.js externalizes
	// @firebase/auth). Without rewriting these to their vendor paths, the
	// browser fetches the vendor file at runtime and chokes on bare specifiers.
	// Run AFTER all vendor builds so every framework's path map is included.
	stepStartedAt = performance.now();
	const combinedVendorPaths: Record<string, string> = {
		...(getDevVendorPaths() ?? {}),
		...(getAngularVendorPaths() ?? {}),
		...(getSvelteVendorPaths() ?? {}),
		...(getVueVendorPaths() ?? {}),
		...depPaths
	};
	const activeVendorDirs = [
		config.reactDirectory ? reactVendorDir : null,
		config.angularDirectory ? angularVendorDir : null,
		config.svelteDirectory ? svelteVendorDir : null,
		config.vueDirectory ? vueVendorDir : null,
		depVendorDir
	].filter((d): d is string => d !== null);
	const { rewriteVendorDirectories } = await import(
		'../build/rewriteImports'
	);
	await rewriteVendorDirectories(activeVendorDirs, combinedVendorPaths);
	recordStep('rewrite vendor cross-references', stepStartedAt);

	// Load the (now-rewritten) vendor files into the in-memory asset store.
	stepStartedAt = performance.now();
	await Promise.all([
		config.reactDirectory
			? loadVendorFiles(state.assetStore, reactVendorDir, 'react')
			: Promise.resolve(),
		config.angularDirectory
			? loadVendorFiles(state.assetStore, angularVendorDir, 'angular')
			: Promise.resolve(),
		config.svelteDirectory
			? loadVendorFiles(state.assetStore, svelteVendorDir, 'svelte')
			: Promise.resolve(),
		config.vueDirectory
			? loadVendorFiles(state.assetStore, vueVendorDir, 'vue')
			: Promise.resolve(),
		loadVendorFiles(state.assetStore, depVendorDir, 'vendor')
	]);
	if (config.reactDirectory && !globalThis.__reactModuleRef) {
		globalThis.__reactModuleRef = await import('react');
	}
	recordStep('load vendor files', stepStartedAt);

	// Pre-warm framework compilers so the first HMR edit is fast.
	// Sets the module-level compiler references in moduleServer.ts
	// so transformSvelteFile/transformVueFile skip the dynamic import.
	stepStartedAt = performance.now();
	const { warmCompilers } = await import('../dev/moduleServer');
	await warmCompilers({
		svelte: Boolean(config.svelteDirectory),
		vue: Boolean(config.vueDirectory)
	});
	recordStep('warm compilers', stepStartedAt);

	// Store initial manifest on HMR state for Angular fast-path HMR
	state.manifest = manifest;

	stepStartedAt = performance.now();
	startFileWatching(state, config, (filePath: string) => {
		queueFileChange(state, filePath, config, (newBuildResult) => {
			Object.assign(manifest, newBuildResult.manifest);
			state.manifest = manifest;
		});
	});
	recordStep('start file watching', stepStartedAt);

	// Store build duration for the startup banner (printed by networking plugin)
	globalThis.__hmrBuildDuration = performance.now() - buildStart;
	logStartupTimingBlock('AbsoluteJS devBuild timing', startupSteps);

	const result: NonNullable<typeof globalThis.__hmrDevResult> = {
		conventions,
		hmrState: state,
		manifest
	};

	// Cache for Bun --hot reloads
	globalThis.__hmrDevResult = result;
	globalThis.__hmrServerMtime = statSync(resolve(Bun.main)).mtimeMs;

	return result;
};
