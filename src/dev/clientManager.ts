import type { FSWatcher } from 'fs';
import { emptyDependencyGraph, type DependencyGraph } from './dependencyGraph';
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
	activeFrameworks: Set<string>; // Frameworks with active browser clients
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
	rebuildCount: number; // Incremented after each successful rebuild
	lastHmrPath?: string;
	lastHmrFramework?: string;
	// Set captured at the start of each rebuild cycle: the user's actual
	// edited files BEFORE the dependency graph adds transitive dependents
	// to `filesToRebuild`. Consumed by Angular's HMR classifier so it
	// classifies the real edit (e.g. a `.component.css` file) instead of
	// a page bundle that the graph dragged in.
	lastUserEditedFiles?: Set<string>;
	/* Set to `true` by `devBuild` when the initial cold-start
	 * `build()` throws on a user-source error. The next file change
	 * routes to a full `build()` instead of the fast-path
	 * `queueFileChange` so all manifest entries (page, index, CSS,
	 * vendor) get populated from scratch — the fast-path only
	 * updates the directly-edited file's entry. Cleared once a
	 * recovery build succeeds. */
	initialBuildFailed?: boolean;
	/* Resolved paths of `.svelte` files the surgical fast path already
	 * broadcast a `svelte-update` for in the current rebuild cycle.
	 * Consumed by `handleSvelteHMR` to suppress the redundant
	 * page-update broadcast (which re-bootstraps the page and discards
	 * component-local state) for files the fast path already swapped in
	 * place. Reset at the start of each rebuild. */
	svelteSurgicallyHandled?: Set<string>;
};

/* Initialize HMR state */
export const createHMRState = (config: BuildConfig): HMRState => ({
	activeFrameworks: new Set(), // Frameworks with active browser clients
	assetStore: new Map(), // In-memory client asset store for dev mode,,
	config,
	connectedClients: new Set<HMRWebSocket>(),
	debounceTimeout: null,
	dependencyGraph: emptyDependencyGraph,
	fileChangeQueue: new Map(),
	fileHashes: new Map(),
	isRebuilding: false,
	manifest: {}, // Current build manifest (populated after initial build),
	moduleVersions: createModuleVersionTracker(),
	rebuildCount: 0,
	rebuildQueue: new Set(),
	rebuildTimeout: null,
	resolvedPaths: resolveBuildPaths(config), // Track versions for source files to bypass Bun's cache,
	sourceFileVersions: new Map(),
	vueChangeTypes: new Map(), // Vue HMR change type tracking,
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
