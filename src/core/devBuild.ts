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
import { createHMRState, type HMRState } from '../dev/clientManager';
import { buildInitialDependencyGraph } from '../dev/dependencyGraph';
import { startFileWatching } from '../dev/fileWatcher';
import { getWatchPaths } from '../dev/pathUtils';
import { cleanStaleAssets, populateAssetStore } from '../dev/assetStore';
import { queueFileChange } from '../dev/rebuildTrigger';
import { logServerReload } from '../utils/logger';

const handleCachedReload = () => {
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
	const entries = await readdir(vendorDir).catch(() => [] as string[]);
	for (const entry of entries) {
		const webPath = `/${framework}/vendor/${entry}`;
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
		handleCachedReload();

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

	const result = {
		hmrState: state,
		manifest
	};

	// Cache for Bun --hot reloads
	globalThis.__hmrDevResult = result;
	globalThis.__hmrServerMtime = statSync(resolve(Bun.main)).mtimeMs;

	return result;
};
