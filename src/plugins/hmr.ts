import Elysia from 'elysia';
import { HMRState } from '../dev/clientManager';
import {
	handleClientConnect,
	handleClientDisconnect,
	handleHMRMessage
} from '../dev/webSocket';

/* HMR plugin for Elysia
   Adds WebSocket endpoint and status endpoint.
   NOTE: HMR client injection is done in pageHandlers.ts via maybeInjectHMR(),
   not here. Elysia snapshots hooks at route registration time, so onAfterHandle
   added here won't apply to routes defined before this plugin is registered. */
export function hmr(hmrState: HMRState, manifest: Record<string, string>) {
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
}
