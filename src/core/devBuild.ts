import { readdir } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from './build';
import { setDevVendorPaths } from './devVendorPaths';
import type { BuildConfig } from '../../types/build';
import {
	buildReactVendor,
	computeVendorPaths
} from '../build/buildReactVendor';
import { createHMRState, type HMRState } from '../dev/clientManager';
import { buildInitialDependencyGraph } from '../dev/dependencyGraph';
import { startFileWatching } from '../dev/fileWatcher';
import { getWatchPaths } from '../dev/pathUtils';
import { cleanStaleAssets, populateAssetStore } from '../dev/assetStore';
import { queueFileChange } from '../dev/rebuildTrigger';
import { logger } from '../utils/logger';

/* Development mode function - replaces build() during development
   Returns DevResult with manifest, buildDir, asset(), and hmrState for use with the hmr() plugin */
export const devBuild = async (config: BuildConfig) => {
	// On Bun --hot reload, return cached result instead of rebuilding
	const cached = (globalThis as Record<string, unknown>).__hmrDevResult as
		| {
				hmrState: HMRState;
				manifest: Record<string, string>;
		  }
		| undefined;
	if (cached) {
		const serverMtime = statSync(resolve(Bun.main)).mtimeMs;
		const lastMtime = (globalThis as Record<string, unknown>)
			.__hmrServerMtime as number;
		(globalThis as Record<string, unknown>).__hmrServerMtime = serverMtime;

		if (serverMtime !== lastMtime) {
			logger.serverReload();
		} else {
			// Framework file changed — skip server restart, let HMR handle it
			(globalThis as Record<string, unknown>).__hmrSkipServerRestart =
				true;
		}
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

	// Store version for the startup banner
	// Try multiple paths: '../..' works from source (src/core/devBuild.ts),
	// '..' works from bundled dist (dist/index.js)
	const candidates = [
		resolve(import.meta.dir, '..', '..', 'package.json'),
		resolve(import.meta.dir, '..', 'package.json')
	];
	for (const candidate of candidates) {
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

	const buildStart = performance.now();

	// Initial build (HMR client is baked into index files and HTML/HTMX pages)
	const manifest = await build({
		...config,
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
	// These stable files (no content hash) are what the rewritten
	// imports in the build output point to.
	if (config.reactDirectory) {
		await buildReactVendor(state.resolvedPaths.buildDir);

		// Load vendor files into the in-memory asset store
		const vendorDir = resolve(
			state.resolvedPaths.buildDir,
			'react',
			'vendor'
		);
		try {
			const entries = await readdir(vendorDir);
			for (const entry of entries) {
				const webPath = `/react/vendor/${entry}`;
				const bytes = await Bun.file(resolve(vendorDir, entry)).bytes();
				state.assetStore.set(webPath, bytes);
			}
		} catch {
			/* vendor dir may not exist if React build failed */
		}
	}

	startFileWatching(state, config, (filePath: string) => {
		queueFileChange(state, filePath, config, (newBuildResult) => {
			Object.assign(manifest, newBuildResult.manifest);
		});
	});

	// Store build duration for the startup banner (printed by networking plugin)
	(globalThis as Record<string, unknown>).__hmrBuildDuration =
		performance.now() - buildStart;

	const result = {
		hmrState: state,
		manifest
	};

	// Cache for Bun --hot reloads
	(globalThis as Record<string, unknown>).__hmrDevResult = result;
	(globalThis as Record<string, unknown>).__hmrServerMtime = statSync(
		resolve(Bun.main)
	).mtimeMs;

	return result;
};
