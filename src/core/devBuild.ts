import { readdir } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from './build';
import { setDevVendorPaths, setAngularVendorPaths } from './devVendorPaths';
import type { BuildConfig } from '../../types/build';
import {
	buildReactVendor,
	computeVendorPaths
} from '../build/buildReactVendor';
import {
	buildAngularVendor,
	computeAngularVendorPaths
} from '../build/buildAngularVendor';
import { createHMRState } from '../dev/clientManager';
import { resolveBuildPaths } from '../dev/configResolver';
import { buildInitialDependencyGraph } from '../dev/dependencyGraph';
import { addFileWatchers, startFileWatching } from '../dev/fileWatcher';
import { getWatchPaths } from '../dev/pathUtils';
import { cleanStaleAssets, populateAssetStore } from '../dev/assetStore';
import { queueFileChange } from '../dev/rebuildTrigger';
import { logServerReload } from '../utils/logger';

const FRAMEWORK_DIR_KEYS = [
	'reactDirectory',
	'svelteDirectory',
	'vueDirectory',
	'htmlDirectory',
	'htmxDirectory',
	'angularDirectory'
] as const;

/** Re-read absolute.config.ts bypassing Bun's module cache by parsing the file directly */
const reloadConfig = async (): Promise<Partial<BuildConfig> | null> => {
	try {
		const configPath = resolve(
			process.env.ABSOLUTE_CONFIG ?? 'absolute.config.ts'
		);
		const source = await Bun.file(configPath).text();

		// Extract directory values from the config source.
		// Config files use defineConfig({ key: 'value' }) format.
		const config: Partial<BuildConfig> = {};
		const dirPattern = /(\w+Directory)\s*:\s*['"]([^'"]+)['"]/g;
		let match;
		while ((match = dirPattern.exec(source)) !== null) {
			const [, key, value] = match;
			(config as Record<string, string>)[key!] = value!;
		}

		return Object.keys(config).length > 0 ? config : null;
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
	let hasChanges = false;
	for (const key of FRAMEWORK_DIR_KEYS) {
		if (newConfig[key] !== oldConfig[key]) {
			hasChanges = true;
			break;
		}
	}
	if (!hasChanges) return;

	// Snapshot old watch paths before updating config
	const oldWatchPaths = new Set(
		getWatchPaths(oldConfig, state.resolvedPaths)
	);

	// Update config in-place so all references stay valid
	for (const key of FRAMEWORK_DIR_KEYS) {
		(state.config as Record<string, unknown>)[key] = newConfig[key];
	}
	state.resolvedPaths = resolveBuildPaths(state.config);

	// Set up vendor paths for newly added React/Angular
	if (!oldConfig.reactDirectory && Boolean(newConfig.reactDirectory)) {
		setDevVendorPaths(computeVendorPaths());
	}
	if (!oldConfig.angularDirectory && Boolean(newConfig.angularDirectory)) {
		setAngularVendorPaths(computeAngularVendorPaths());
	}

	// Compute new watch paths and start watchers for additions
	const newWatchPaths = getWatchPaths(state.config, state.resolvedPaths);
	const addedPaths = newWatchPaths.filter((p) => !oldWatchPaths.has(p));

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

/** Rebuild manifest and update asset store — called on every server.ts HMR reload.
 *  Sets isRebuilding to prevent the file-watcher fast path from running concurrently,
 *  which would delete the indexes directory mid-build and cause ModuleNotFound errors. */
const rebuildManifest = async (
	cached: NonNullable<typeof globalThis.__hmrDevResult>
) => {
	const state = cached.hmrState;

	// Wait for any in-flight file-watcher build to finish before starting.
	// Without this, a concurrent fast-path build (React, Vue, Svelte) can
	// delete intermediate directories (indexes/, server/) while this full
	// build is trying to read from them, causing ModuleNotFound errors.
	while (state.isRebuilding) {
		await Bun.sleep(10);
	}

	state.isRebuilding = true;

	try {
		const newManifest = await build({
			...state.config,
			mode: 'development',
			options: {
				...state.config.options,
				injectHMR: true,
				throwOnError: true
			}
		});
		if (newManifest) {
			// Replace manifest contents instead of just merging.
			// Object.assign only adds/updates keys — it never removes them,
			// so deleted pages would leave dead keys in the manifest forever.
			// Deleting stale keys first ensures cleanStaleAssets can also
			// remove orphaned build artifacts from disk.
			for (const key of Object.keys(cached.manifest)) {
				if (!(key in newManifest)) {
					delete (cached.manifest as Record<string, unknown>)[key];
				}
			}
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
		}
		state.rebuildCount++;
	} catch {
		// Build errors are logged by build() itself
	} finally {
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
		setAngularVendorPaths(computeAngularVendorPaths());
	}

	if (serverMtime !== lastMtime) {
		logServerReload();
		if (cached) {
			// Detect config changes (new framework directories) and update watchers
			await detectConfigChanges(cached);
			// Always rebuild when server.ts changes — new pages/routes may have been added
			// even if config directories haven't changed
			await rebuildManifest(cached);
		}
	} else {
		globalThis.__hmrSkipServerRestart = true;
	}
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
	for (const candidate of candidates) {
		// eslint-disable-next-line no-await-in-loop -- iterations depend on each other (short-circuits on first match)
		const found = await tryReadPackageVersion(candidate);
		if (found) {
			return;
		}
	}
};

const loadVendorFiles = async (
	assetStore: Map<string, Uint8Array>,
	vendorDir: string,
	framework: string
) => {
	const emptyStringArray: string[] = [];
	const entries = await readdir(vendorDir).catch(() => emptyStringArray);
	for (const entry of entries) {
		const webPath = `/${framework}/vendor/${entry}`;
		// eslint-disable-next-line no-await-in-loop -- iterations depend on each other (sequential asset loading)
		const bytes = await Bun.file(resolve(vendorDir, entry)).bytes();
		assetStore.set(webPath, bytes);
	}
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

	// Create initial HMR state with config
	const state = createHMRState(config);

	// Initialize dependency graph by scanning all source files
	const watchPaths = getWatchPaths(config, state.resolvedPaths);
	buildInitialDependencyGraph(state.dependencyGraph, watchPaths);

	// Pre-compute vendor paths so build() can externalize React.
	// The actual vendor files are built after build() creates the output dir.
	if (config.reactDirectory) {
		setDevVendorPaths(computeVendorPaths());
	}
	if (config.angularDirectory) {
		setAngularVendorPaths(computeAngularVendorPaths());
	}

	await resolveAbsoluteVersion();

	const buildStart = performance.now();

	// Initial build (HMR client is baked into index files and HTML/HTMX pages)
	const manifest = await build({
		...config,
		mode: 'development',
		options: {
			...config.options,
			injectHMR: true
		}
	});

	if (!manifest || Object.keys(manifest).length === 0) {
		// Allow empty manifests for HTML/HTMX-only projects
		console.log(
			'⚠️ Manifest is empty - this is OK for HTML/HTMX-only projects'
		);
	}

	// Populate in-memory asset store so client assets are served from memory
	await populateAssetStore(
		state.assetStore,
		manifest ?? {},
		state.resolvedPaths.buildDir
	);
	await cleanStaleAssets(
		state.assetStore,
		manifest ?? {},
		state.resolvedPaths.buildDir
	);

	// Build React vendor files now that the build directory exists.
	if (config.reactDirectory) {
		await buildReactVendor(state.resolvedPaths.buildDir);
		const vendorDir = resolve(
			state.resolvedPaths.buildDir,
			'react',
			'vendor'
		);
		await loadVendorFiles(state.assetStore, vendorDir, 'react');
	}

	// Build Angular vendor files — same pattern as React.
	if (config.angularDirectory) {
		await buildAngularVendor(state.resolvedPaths.buildDir);
		const vendorDir = resolve(
			state.resolvedPaths.buildDir,
			'angular',
			'vendor'
		);
		await loadVendorFiles(state.assetStore, vendorDir, 'angular');
	}

	// Store initial manifest on HMR state for Angular fast-path HMR
	state.manifest = manifest;

	startFileWatching(state, config, (filePath: string) => {
		queueFileChange(state, filePath, config, (newBuildResult) => {
			Object.assign(manifest, newBuildResult.manifest);
			state.manifest = manifest;
		});
	});

	// Store build duration for the startup banner (printed by networking plugin)
	globalThis.__hmrBuildDuration = performance.now() - buildStart;

	const result: NonNullable<typeof globalThis.__hmrDevResult> = {
		hmrState: state,
		manifest
	};

	// Cache for Bun --hot reloads
	globalThis.__hmrDevResult = result;
	globalThis.__hmrServerMtime = statSync(resolve(Bun.main)).mtimeMs;

	return result;
};
