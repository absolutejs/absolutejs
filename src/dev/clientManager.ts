import { watch } from 'fs';
import type { FSWatcher } from 'fs';
import { createDependencyGraph, type DependencyGraph } from './dependencyGraph';
import { createModuleVersionTracker, type ModuleVersions } from './moduleVersionTracker';
import type { HMRWebSocket } from './types/websocket';

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
};

/* Initialize HMR state */
export const createHMRState = () => ({
    connectedClients: new Set(), debounceTimeout: null, dependencyGraph: createDependencyGraph(), fileChangeQueue: new Map(), fileHashes: new Map(), isRebuilding: false, moduleVersions: createModuleVersionTracker(), rebuildQueue: new Set(), rebuildTimeout: null, sourceFileVersions: new Map(), watchers: [], // Track versions for source files to bypass Bun's cache
  })

/* Add a client to tracking */
export const addClient = (state: HMRState, client: HMRWebSocket) => {
  console.log('🔥 HMR client connected');
  state.connectedClients.add(client);
}

/* Remove a client from tracking */
export const removeClient = (state: HMRState, client: HMRWebSocket) => {
  console.log('🔥 HMR client disconnected');
  state.connectedClients.delete(client);
}

/* Get client count */
export const getClientCount = (state: HMRState) => state.connectedClients.size

/* Get version for a source file (for cache busting) */
export const getSourceFileVersion = (state: HMRState, filePath: string) => state.sourceFileVersions.get(filePath) || 0

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