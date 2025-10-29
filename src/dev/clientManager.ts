import { createDependencyGraph, DependencyGraph } from '../dev/dependencyGraph'

export type HMRState = {
  dependencyGraph: DependencyGraph;

  connectedClients: Set<any>;
  isRebuilding: boolean;

  rebuildQueue: Set<string>;
  rebuildTimeout: NodeJS.Timeout | null;

  fileChangeQueue: Map<string, string[]>;
  debounceTimeout: NodeJS.Timeout | null;

  fileHashes: Map<string, string>;
  watchers: any[];

  // Optional fields used elsewhere
  server?: any;
  manifest?: Record<string, any>;
  config?: any;
  changedFiles?: Set<string>;

  broadcast?: (msg: any) => void;
  scheduleRebuild?: () => void;
};

export function createHMRState(): HMRState {
  return {
    dependencyGraph: createDependencyGraph(),

    connectedClients: new Set<any>(),
    isRebuilding: false,

    rebuildQueue: new Set<string>(),
    rebuildTimeout: null,

    fileChangeQueue: new Map<string, string[]>(),
    debounceTimeout: null,

    fileHashes: new Map<string, string>(),
    watchers: [],

    changedFiles: new Set<string>(),
    broadcast: () => {},
    scheduleRebuild: () => {},
  };
}

export function addClient(state: HMRState, client: any): void {
  state.connectedClients.add(client);
}

export function removeClient(state: HMRState, client: any): void {
  state.connectedClients.delete(client);
}

export function getClientCount(state: HMRState): number {
  return state.connectedClients.size;
}
