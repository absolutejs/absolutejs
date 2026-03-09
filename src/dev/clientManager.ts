import type { FSWatcher } from 'fs';
import { createDependencyGraph, type DependencyGraph } from './dependencyGraph';
import {
	createModuleVersionTracker,
	type ModuleVersions
} from './moduleVersionTracker';
import type { HMRWebSocket } from '../../types/websocket';
import type { BuildConfig } from '../../types/build';
import { resolveBuildPaths, type ResolvedBuildPaths } from './configResolver';

/* This handles the "tracking clients" problem */
export type HMRState = {
	connectedClients: Set<HMRWebSocket>;
	dependencyGraph: DependencyGraph;
	isRebuilding: boolean;
	rebuildQueue: Set<string>;
	rebuildTimeout: NodeJS.Timeout | null;
	fileChangeQueue: Map<string, string[]>;
	debounceTimeout: NodeJS.Timeout | null;
	fileHashes: Map<string, number>; // filename -> Bun.hash (Wyhash) value
	watchers: FSWatcher[];
	moduleVersions: ModuleVersions; // module path -> version number (for client-server sync)
	sourceFileVersions: Map<string, number>; // source file path -> version number (for cache busting)
	config: BuildConfig; // Build configuration for path resolution
	resolvedPaths: ResolvedBuildPaths; // Normalized paths derived from config
	vueChangeTypes: Map<string, 'template-only' | 'script' | 'full'>; // Vue HMR change type tracking
	assetStore: Map<string, Uint8Array>; // In-memory client asset store for dev mode
	manifest: Record<string, string>; // Current build manifest (for Angular fast-path HMR)
};

/* Initialize HMR state */
export const createHMRState = (config: BuildConfig): HMRState => ({
	assetStore: new Map(), // In-memory client asset store for dev mode,
	config,
	connectedClients: new Set<HMRWebSocket>(),
	debounceTimeout: null,
	dependencyGraph: createDependencyGraph(),
	fileChangeQueue: new Map(),
	fileHashes: new Map(),
	isRebuilding: false,
	manifest: {}, // Current build manifest (populated after initial build)
	moduleVersions: createModuleVersionTracker(),
	rebuildQueue: new Set(),
	rebuildTimeout: null,
	resolvedPaths: resolveBuildPaths(config), // Track versions for source files to bypass Bun's cache
	sourceFileVersions: new Map(),
	vueChangeTypes: new Map(), // Vue HMR change type tracking
	watchers: []
});

/* Increment version for a source file (forces Bun to treat it as a new module) */
export const incrementSourceFileVersion = (
	state: HMRState,
	filePath: string
) => {
	const currentVersion = state.sourceFileVersions.get(filePath) || 0;
	const newVersion = currentVersion + 1;
	state.sourceFileVersions.set(filePath, newVersion);

	return newVersion;
};

/* Increment versions for multiple source files */
export const incrementSourceFileVersions = (
	state: HMRState,
	filePaths: string[]
) => {
	for (const filePath of filePaths) {
		incrementSourceFileVersion(state, filePath);
	}
};
