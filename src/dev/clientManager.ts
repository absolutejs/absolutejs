import type { DependencyGraph } from './dependencyGraph';
import { createDependencyGraph } from './dependencyGraph';
import type { ModuleVersions } from './moduleVersionTracker';
import { createModuleVersionTracker } from './moduleVersionTracker';

/* This handles the "tracking clients" problem */
export type HMRState = {
  connectedClients: Set<any>;
  dependencyGraph: DependencyGraph;
  isRebuilding: boolean;
  rebuildQueue: Set<string>;
  rebuildTimeout: NodeJS.Timeout | null;
  fileChangeQueue: Map<string, string[]>;
  debounceTimeout: NodeJS.Timeout | null;
  fileHashes: Map<string, string>; // filename -> SHA-256 hash
  watchers: any[];
  moduleVersions: ModuleVersions; // module path -> version number (for client-server sync)
  sourceFileVersions: Map<string, number>; // source file path -> version number (for cache busting)
};

/* Initialize HMR state */
export function createHMRState(): HMRState {
  return {
    connectedClients: new Set(), 
    debounceTimeout: null, 
    fileChangeQueue: new Map(), 
    isRebuilding: false, 
    rebuildQueue: new Set(), 
    rebuildTimeout: null, 
    watchers: [], 
    fileHashes: new Map(), 
    dependencyGraph: createDependencyGraph(),
    moduleVersions: createModuleVersionTracker(),
    sourceFileVersions: new Map(), // Track versions for source files to bypass Bun's cache
  };
}

/* Add a client to tracking */
export function addClient(state: HMRState, client: any): void {
  console.log('🔥 HMR client connected');
  state.connectedClients.add(client);
}

/* Remove a client from tracking */
export function removeClient(state: HMRState, client: any): void {
  console.log('🔥 HMR client disconnected');
  state.connectedClients.delete(client);
}

/* Get client count */
export function getClientCount(state: HMRState): number {
  return state.connectedClients.size;
}

/* Get version for a source file (for cache busting) */
export function getSourceFileVersion(state: HMRState, filePath: string): number {
  return state.sourceFileVersions.get(filePath) || 0;
}

/* Increment version for a source file (forces Bun to treat it as a new module) */
export function incrementSourceFileVersion(state: HMRState, filePath: string): number {
  const currentVersion = state.sourceFileVersions.get(filePath) || 0;
  const newVersion = currentVersion + 1;
  state.sourceFileVersions.set(filePath, newVersion);
  return newVersion;
}

/* Increment versions for multiple source files */
export function incrementSourceFileVersions(state: HMRState, filePaths: string[]): void {
  for (const filePath of filePaths) {
    incrementSourceFileVersion(state, filePath);
  }
}