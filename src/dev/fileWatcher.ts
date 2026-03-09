import { watch } from 'fs';
import { existsSync } from 'node:fs';
import { join, resolve } from 'path';
import type { BuildConfig } from '../../types/build';
import { sendTelemetryEvent } from '../cli/telemetryEvent';
import type { HMRState } from './clientManager';
import { addFileToGraph, removeFileFromGraph } from './dependencyGraph';
import { getWatchPaths, shouldIgnorePath } from './pathUtils';

/* Set up file watching for all configured directories
   This handles the "watch files" problem */
export const startFileWatching = (
	state: HMRState,
	config: BuildConfig,
	onFileChange: (filePath: string) => void
) => {
	const watchPaths = getWatchPaths(config, state.resolvedPaths);

	const stylesDir = state.resolvedPaths?.stylesDir;

	// Set up a watcher for each directory
	for (const path of watchPaths) {
		// Resolve to absolute path for existsSync check (normalize to forward slashes for cross-platform)
		const absolutePath = resolve(path).replace(/\\/g, '/');

		if (!existsSync(absolutePath)) {
			continue;
		}

		// Check if this watched path is the configured styles directory
		const isStylesDir =
			stylesDir && absolutePath.startsWith(stylesDir);

		const watcher = watch(
			absolutePath,
			{ recursive: true },
			(event, filename) => {
				// Skip if no filename
				if (!filename) return;

				// Skip directory changes (but allow styles directory through)
				if (
					!isStylesDir &&
					(filename === 'compiled' ||
						filename === 'build' ||
						filename === 'indexes' ||
						filename === 'server' ||
						filename === 'client' ||
						filename.includes('/compiled') ||
						filename.includes('/build') ||
						filename.includes('/indexes') ||
						filename.includes('/server') ||
						filename.includes('/client')) ||
					filename.endsWith('/')
				) {
					return;
				}

				// Build the full path (normalize to forward slashes for cross-platform compatibility)
				const fullPath = join(absolutePath, filename).replace(
					/\\/g,
					'/'
				);

				// Apply ignore patterns
				if (shouldIgnorePath(fullPath, state.resolvedPaths)) {
					return;
				}

				// Handle file deletion
				if (event === 'rename' && !existsSync(fullPath)) {
					try {
						removeFileFromGraph(state.dependencyGraph, fullPath);
					} catch (err) {
						sendTelemetryEvent('hmr:graph-error', {
							operation: 'remove',
							message:
								err instanceof Error ? err.message : String(err)
						});
					}

					// Still trigger rebuild for files that depended on this one
					onFileChange(fullPath);

					return;
				}

				// Handle file creation/modification
				if (existsSync(fullPath)) {
					// Call the callback handler
					onFileChange(fullPath);

					try {
						addFileToGraph(state.dependencyGraph, fullPath);
					} catch (err) {
						sendTelemetryEvent('hmr:graph-error', {
							operation: 'add',
							message:
								err instanceof Error ? err.message : String(err)
						});
					}
				}
			}
		);

		state.watchers.push(watcher);
	}
};
