import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from './build';
import type { BuildConfig } from '../../types/build';
import { createHMRState, type HMRState } from '../dev/clientManager';
import { buildInitialDependencyGraph } from '../dev/dependencyGraph';
import { startFileWatching } from '../dev/fileWatcher';
import { getWatchPaths } from '../dev/pathUtils';
import { cleanStaleAssets, populateAssetStore } from '../dev/assetStore';
import { queueFileChange } from '../dev/rebuildTrigger';

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
			console.log('\x1b[36m[hmr] Server module reloaded\x1b[0m');
		} else {
			// Framework file changed — skip server restart, let HMR handle it
			(globalThis as Record<string, unknown>).__hmrSkipServerRestart =
				true;
			console.log('\x1b[36m[hmr] Hot module update detected\x1b[0m');
		}
		return cached;
	}

	// Create initial HMR state with config
	const state = createHMRState(config);

	// Initialize dependency graph by scanning all source files
	const watchPaths = getWatchPaths(config, state.resolvedPaths);
	buildInitialDependencyGraph(state.dependencyGraph, watchPaths);

	console.log('🔨 Building AbsoluteJS with HMR...');

	// Initial build (HMR client is baked into index files and HTML/HTMX pages)
	const manifest = await build({
		...config,
		options: {
			...config.options,
			injectHMR: true,
			preserveIntermediateFiles: true
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

	console.log('✅ Build completed successfully');

	startFileWatching(state, config, (filePath: string) => {
		queueFileChange(state, filePath, config, (newBuildResult) => {
			Object.assign(manifest, newBuildResult.manifest);
		});
	});

	console.log('👀 File watching: Active');
	console.log('🔥 HMR: Ready');

	const result = {
		hmrState: state,
		manifest
	};

	(globalThis as Record<string, unknown>).__hmrServerStartup =
		Date.now().toString();

	// Cache for Bun --hot reloads
	(globalThis as Record<string, unknown>).__hmrDevResult = result;
	(globalThis as Record<string, unknown>).__hmrServerMtime = statSync(
		resolve(Bun.main)
	).mtimeMs;

	return result;
};
