import Elysia from 'elysia';
import { HMRState } from '../dev/clientManager';
import {
	handleClientConnect,
	handleClientDisconnect,
	handleHMRMessage
} from '../dev/webSocket';

/* HMR plugin for Elysia
   Adds WebSocket endpoint and status endpoint.
   HMR client code is baked into framework index files (React/Svelte/Vue)
   and injected into HTML/HTMX files at build time. */
export const hmr = (hmrState: HMRState, manifest: Record<string, string>) => {
	return (app: Elysia) => {
		return app
			.ws('/hmr', {
				close: (ws) => handleClientDisconnect(hmrState, ws),
				message: (ws, msg) => handleHMRMessage(hmrState, ws, msg),
				open: (ws) => handleClientConnect(hmrState, ws, manifest)
			})
			.get('/hmr-status', () => ({
				connectedClients: hmrState.connectedClients.size,
				isRebuilding: hmrState.isRebuilding,
				manifestKeys: Object.keys(manifest),
				rebuildQueue: Array.from(hmrState.rebuildQueue),
				timestamp: Date.now()
			}));
	};
};
