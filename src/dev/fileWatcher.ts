import { watch } from 'fs';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'path';
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

// Atomic-write temp files created by editors mid-save. These exist for
// milliseconds before being renamed over the real target — firing the HMR
// pipeline on them either no-ops (if the temp has no dependents) or
// emits a spurious `[abs:restart]` marker that triggers a full restart
// when the actual edit could have been handled in-place.
const ATOMIC_WRITE_TEMP_PATTERNS = [
	// sed -i: `sed[A-Za-z0-9]+`, no extension
	/(^|\/)sed[A-Za-z0-9]{6,}$/,
	// vim's "4913" probe file used to test write permissions
	/(^|\/)4913$/
];

const shouldSkipFilename = (filename: string, isStylesDir: boolean) =>
	(!isStylesDir &&
		(filename === 'compiled' ||
			filename === 'generated' ||
			filename === 'build' ||
			filename === 'indexes' ||
			filename === 'server' ||
			filename === 'client' ||
			filename.includes('/compiled/') ||
			filename.includes('/generated/') ||
			filename.includes('/build/') ||
			filename.includes('/indexes/') ||
			filename.includes('/server/') ||
			filename.includes('/client/') ||
			filename.startsWith('compiled/') ||
			filename.startsWith('generated/') ||
			filename.startsWith('build/') ||
			filename.startsWith('indexes/') ||
			filename.startsWith('server/') ||
			filename.startsWith('client/'))) ||
	filename.endsWith('/') ||
	filename.includes('.tmp.') ||
	filename.endsWith('.tmp') ||
	filename.endsWith('~') ||
	filename.startsWith('.#') ||
	ATOMIC_WRITE_TEMP_PATTERNS.some((re) => re.test(filename));

const setupWatcher = (
	absolutePath: string,
	isStylesDir: boolean,
	state: HMRState,
	onFileChange: (filePath: string) => void
) => {
	// Atomic-write recovery scan. Linux/Node `fs.watch(recursive: true)`
	// reliably delivers IN_MOVED_FROM for the temp filename in an atomic
	// rename (sed -i, vim default, prettier, etc.) but drops IN_MOVED_TO
	// for the destination when the destination already existed in the
	// watched dir. Without recovery, every editor save to an existing
	// source file is invisible to the framework's HMR pipeline.
	//
	// When we observe a temp-file rename event we walk the same parent
	// dir for files whose ctime is fresh (last 1s), and synthesize an
	// onFileChange for each. The temp file itself is filtered upstream;
	// dir entries we already track separately (recursive watch will
	// surface them through their own events) get deduplicated.
	const ATOMIC_RECOVERY_WINDOW_MS = 1000;
	const recentlySynthesized = new Map<string, number>();
	const atomicRecoveryScan = (eventDir: string) => {
		let entries: string[];
		try {
			entries = readdirSync(eventDir);
		} catch {
			return;
		}
		const now = Date.now();
		for (const name of entries) {
			if (shouldSkipFilename(name, isStylesDir)) continue;
			const child = join(eventDir, name).replace(/\\/g, '/');
			let st: ReturnType<typeof statSync>;
			try {
				st = statSync(child);
			} catch {
				continue;
			}
			if (!st.isFile()) continue;
			const age = now - st.ctimeMs;
			if (age < 0 || age > ATOMIC_RECOVERY_WINDOW_MS) continue;
			const last = recentlySynthesized.get(child) ?? 0;
			if (now - last < 100) continue;
			recentlySynthesized.set(child, now);
			onFileChange(child);
			safeAddToGraph(state.dependencyGraph, child);
		}
	};

	const watcher = watch(
		absolutePath,
		{ recursive: true },
		(event, filename) => {
			if (!filename) return;
			if (shouldSkipFilename(filename, isStylesDir)) {
				if (event === 'rename') {
					const eventDir = dirname(
						join(absolutePath, filename)
					).replace(/\\/g, '/');
					atomicRecoveryScan(eventDir);
				}

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

/* Add file watchers for specific paths (used when new framework directories are added at runtime) */
export const addFileWatchers = (
	state: HMRState,
	paths: string[],
	onFileChange: (filePath: string) => void
) => {
	const stylesDir = state.resolvedPaths?.stylesDir;

	paths.forEach((path) => {
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
