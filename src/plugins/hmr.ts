import Elysia from 'elysia';
import { HMRState } from '../dev/clientManager';
import {
	handleClientConnect,
	handleClientDisconnect,
	handleHMRMessage
} from '../dev/webSocket';

/* HMR plugin for Elysia
   Adds WebSocket endpoint, status endpoint, and serves the compiled HMR client bundle.
   NOTE: HMR client injection is done per-handler in pageHandlers.ts using native
   framework injection points (TransformStream for React, template options for
   Svelte, string concatenation for Vue, regex for HTML/HTMX). */
export function hmr(
	hmrState: HMRState,
	manifest: Record<string, string>,
	clientBundle: string
) {
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
			}))
			.get(
				'/__hmr-client.js',
				() =>
					new Response(clientBundle, {
						headers: {
							'Cache-Control':
								'no-store, no-cache, must-revalidate',
							'Content-Type': 'application/javascript'
						}
					})
			);
	};
}
