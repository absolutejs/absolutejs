import Elysia from 'elysia';
import { HMRState } from '../dev/clientManager';
import { injectHMRClient } from '../dev/injectHMRClient';
import {
	handleClientConnect,
	handleHMRMessage,
	handleClientDisconnect
} from '../dev/webSocket';

/* HMR plugin for Elysia
   Adds WebSocket endpoint and status endpoint for HMR */
export function hmr(hmrState: HMRState, manifest: Record<string, string>) {
	return (app: Elysia) => {
		return (
			app
				// WebSocket route for HMR updates
				.ws('/hmr', {
					open: (ws) => handleClientConnect(hmrState, ws, manifest),
					message: (ws, msg) => handleHMRMessage(hmrState, ws, msg),
					close: (ws) => handleClientDisconnect(hmrState, ws)
				})
				// Status endpoint for debugging
				.get('/hmr-status', () => ({
					connectedClients: hmrState.connectedClients.size,
					isRebuilding: hmrState.isRebuilding,
					manifestKeys: Object.keys(manifest),
					rebuildQueue: Array.from(hmrState.rebuildQueue),
					timestamp: Date.now()
				}))
				// Intercept and inject HMR client into HTML responses
				.onAfterHandle(async (context) => {
					const { response } = context;

					// Only process Response objects with HTML content
					if (response instanceof Response) {
						const contentType =
							response.headers.get('content-type');
						if (contentType?.includes('text/html')) {
							try {
								const framework =
									response.headers.get('X-HMR-Framework') ||
									null;
								const html = await response.text();
								const htmlWithHMR = injectHMRClient(
									html,
									framework
								);

								const headers = new Headers(
									Object.fromEntries(response.headers)
								);
								headers.set('content-type', contentType);
								headers.set(
									'Cache-Control',
									'no-store, no-cache, must-revalidate'
								);
								headers.set('Pragma', 'no-cache');
								const startup = (
									globalThis as Record<string, unknown>
								).__hmrServerStartup as string | undefined;
								if (startup) {
									headers.set('X-Server-Startup', startup);
								}

								return new Response(htmlWithHMR, {
									status: response.status,
									statusText: response.statusText,
									headers
								});
							} catch {
								return response;
							}
						}
					}

					return response;
				})
		);
	};
}
