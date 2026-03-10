import { watch } from 'fs';
import { existsSync } from 'node:fs';
import { join, resolve } from 'path';
import type { BuildConfig } from '../../types/build';
import { sendTelemetryEvent } from '../cli/telemetryEvent';
import type { HMRState } from './clientManager';
import { addFileToGraph, removeFileFromGraph } from './dependencyGraph';
import { getWatchPaths, shouldIgnorePath } from './pathUtils';

const safeRemoveFromGraph = (
	graph: HMRState['dependencyGraph'],
	fullPath: string
) => {
	try {
		removeFileFromGraph(graph, fullPath);
	} catch (err) {
		sendTelemetryEvent('hmr:graph-error', {
			message: err instanceof Error ? err.message : String(err),
			operation: 'remove'
		});
	}
};

const safeAddToGraph = (
	graph: HMRState['dependencyGraph'],
	fullPath: string
) => {
	try {
		addFileToGraph(graph, fullPath);
	} catch (err) {
		sendTelemetryEvent('hmr:graph-error', {
			message: err instanceof Error ? err.message : String(err),
			operation: 'add'
		});
	}
};

const shouldSkipFilename = (filename: string, isStylesDir: boolean) =>
	(!isStylesDir &&
		(filename === 'compiled' ||
			filename === 'build' ||
			filename === 'indexes' ||
			filename === 'server' ||
			filename === 'client' ||
			filename.includes('/compiled') ||
			filename.includes('/build') ||
			filename.includes('/indexes') ||
			filename.includes('/server') ||
			filename.includes('/client'))) ||
	filename.endsWith('/');

const setupWatcher = (
	absolutePath: string,
	isStylesDir: boolean,
	state: HMRState,
	onFileChange: (filePath: string) => void
) => {
	const watcher = watch(
		absolutePath,
		{ recursive: true },
		(event, filename) => {
			if (!filename) {
				return;
			}
			if (shouldSkipFilename(filename, isStylesDir)) {
				return;
			}

			const fullPath = join(absolutePath, filename).replace(/\\/g, '/');

			if (shouldIgnorePath(fullPath, state.resolvedPaths)) {
				return;
			}

			if (event === 'rename' && !existsSync(fullPath)) {
				safeRemoveFromGraph(state.dependencyGraph, fullPath);
				onFileChange(fullPath);

				return;
			}

			if (existsSync(fullPath)) {
				onFileChange(fullPath);
				safeAddToGraph(state.dependencyGraph, fullPath);
			}
		}
	);

	state.watchers.push(watcher);
};

/* Set up file watching for all configured directories
   This handles the "watch files" problem */
export const startFileWatching = (
	state: HMRState,
	config: BuildConfig,
	onFileChange: (filePath: string) => void
) => {
	const watchPaths = getWatchPaths(config, state.resolvedPaths);
	const stylesDir = state.resolvedPaths?.stylesDir;

	watchPaths.forEach((path) => {
		const absolutePath = resolve(path).replace(/\\/g, '/');
		if (!existsSync(absolutePath)) {
			return;
		}

		const isStylesDir = Boolean(
			stylesDir && absolutePath.startsWith(stylesDir)
		);
		setupWatcher(absolutePath, isStylesDir, state, onFileChange);
	});
};
