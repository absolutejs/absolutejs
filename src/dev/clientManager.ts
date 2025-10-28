/* This handles the "tracking clients" problem */
export type HMRState = {
    connectedClients: Set<any>;
    isRebuilding: boolean;
    rebuildQueue: Set<string>;
    rebuildTimeout: NodeJS.Timeout | null;
    fileChangeQueue: Map<string, string[]>;
    debounceTimeout: NodeJS.Timeout | null;
    fileHashes: Map<string, string>; // filename -> SHA-256 hash
    watchers: any[];
  };
  
  /* Initialize HMR state */
  export function createHMRState(): HMRState {
    return {
      connectedClients: new Set(), debounceTimeout: null, fileChangeQueue: new Map(), isRebuilding: false, rebuildQueue: new Set(), rebuildTimeout: null, watchers: [], fileHashes: new Map(),
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