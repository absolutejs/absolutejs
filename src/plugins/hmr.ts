import Elysia from 'elysia';
import { HMRState } from '../dev/clientManager';
import {
	handleClientConnect,
	handleHMRMessage,
	handleClientDisconnect
} from '../dev/webSocket';

/* HMR plugin for Elysia
   Adds WebSocket endpoint and status endpoint for HMR.
   HTML injection is done in page handlers (pageHandlers.ts) so streaming
   responses can be buffered and transformed before return. */
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
