import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from './build';
import type { BuildConfig } from '../types';
import { createHMRState, type HMRState } from '../dev/clientManager';
import { broadcastToClients } from '../dev/webSocket';
import { buildInitialDependencyGraph } from '../dev/dependencyGraph';
import { startFileWatching } from '../dev/fileWatcher';
import { getWatchPaths } from '../dev/pathUtils';
import { queueFileChange } from '../dev/rebuildTrigger';

/* Development mode function - replaces build() during development
   Returns DevResult with manifest, buildDir, asset(), and hmrState for use with the hmr() plugin */
export async function devBuild(config: BuildConfig) {
	// On Bun --hot reload, return cached result instead of rebuilding
	const cached = (globalThis as Record<string, unknown>).__hmrDevResult as
		| { manifest: Record<string, string>; hmrState: HMRState }
		| undefined;
	if (cached) {
		// Use explicit server entry path from CLI when available; else Bun.main
		const serverEntryPath =
			process.env.ABSOLUTEJS_SERVER_ENTRY ||
			(typeof Bun !== 'undefined' && Bun.main);
		const serverMtime = serverEntryPath
			? statSync(resolve(serverEntryPath)).mtimeMs
			: 0;
		const lastMtime = (globalThis as Record<string, unknown>)
			.__hmrServerMtime as number;
		(globalThis as Record<string, unknown>).__hmrServerMtime = serverMtime;

		if (serverMtime !== lastMtime) {
			console.log('\x1b[36m[hmr] Server module reloaded\x1b[0m');
			broadcastToClients(cached.hmrState, { type: 'full-reload' });
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

	// Initial build
	const manifest = await build({
		...config,
		options: {
			...config.options,
			preserveIntermediateFiles: true
		}
	});

	if (!manifest || Object.keys(manifest).length === 0) {
		// Allow empty manifests for HTML/HTMX-only projects
		console.log(
			'⚠️ Manifest is empty - this is OK for HTML/HTMX-only projects'
		);
	}

	console.log('✅ Build completed successfully');

	startFileWatching(state, config, (filePath: string) => {
		queueFileChange(state, filePath, config, (newBuildResult) => {
			Object.assign(manifest, newBuildResult.manifest);
		});
	});

	console.log('👀 File watching: Active');
	console.log('🔥 HMR: Ready');

	const result = {
		manifest,
		hmrState: state
	};

	(globalThis as Record<string, unknown>).__hmrServerStartup =
		Date.now().toString();

	// Cache for Bun --hot reloads
	(globalThis as Record<string, unknown>).__hmrDevResult = result;
	const serverEntryPath =
		process.env.ABSOLUTEJS_SERVER_ENTRY ||
		(typeof Bun !== 'undefined' && Bun.main);
	(globalThis as Record<string, unknown>).__hmrServerMtime = serverEntryPath
		? statSync(resolve(serverEntryPath)).mtimeMs
		: 0;

	return result;
}
