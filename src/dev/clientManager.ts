import { watch } from 'fs';
import type { FSWatcher } from 'fs';
import { createDependencyGraph, type DependencyGraph } from './dependencyGraph';
import { createModuleVersionTracker, type ModuleVersions } from './moduleVersionTracker';
import type { HMRWebSocket } from './types/websocket';
import type { BuildConfig } from '../types';

/* This handles the "tracking clients" problem */
export type HMRState = {
  connectedClients: Set<HMRWebSocket>;
  dependencyGraph: DependencyGraph;
  isRebuilding: boolean;
  rebuildQueue: Set<string>;
  rebuildTimeout: NodeJS.Timeout | null;
  fileChangeQueue: Map<string, string[]>;
  debounceTimeout: NodeJS.Timeout | null;
  fileHashes: Map<string, string>; // filename -> SHA-256 hash
  watchers: FSWatcher[];
  moduleVersions: ModuleVersions; // module path -> version number (for client-server sync)
  sourceFileVersions: Map<string, number>; // source file path -> version number (for cache busting)
  config: BuildConfig; // Build configuration for path resolution
};

/* Initialize HMR state */
export const createHMRState = (config: BuildConfig): HMRState => ({
    connectedClients: new Set<HMRWebSocket>(), debounceTimeout: null, dependencyGraph: createDependencyGraph(), fileChangeQueue: new Map(), fileHashes: new Map(), isRebuilding: false, moduleVersions: createModuleVersionTracker(), rebuildQueue: new Set(), rebuildTimeout: null, sourceFileVersions: new Map(), watchers: [], config // Track versions for source files to bypass Bun's cache
  })

/* Increment version for a source file (forces Bun to treat it as a new module) */
export const incrementSourceFileVersion = (state: HMRState, filePath: string) => {
  const currentVersion = state.sourceFileVersions.get(filePath) || 0;
  const newVersion = currentVersion + 1;
  state.sourceFileVersions.set(filePath, newVersion);

  return newVersion;
}

/* Increment versions for multiple source files */
export const incrementSourceFileVersions = (state: HMRState, filePaths: string[]) => {
  for (const filePath of filePaths) {
    incrementSourceFileVersion(state, filePath);
  }
}