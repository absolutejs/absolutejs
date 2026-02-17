import Elysia from 'elysia';
import { HMRState } from '../dev/clientManager';
import {
	handleClientConnect,
	handleClientDisconnect,
	handleHMRMessage
} from '../dev/webSocket';

const STORE_KEY = '__elysiaStore';

/* Preserve Elysia store across bun --hot reloads.
   globalThis survives re-evaluation, so we save the store reference
   before each reload and restore values into the fresh instance. */
const restoreStore = (app: Elysia) => {
	const saved = (globalThis as Record<string, unknown>)[STORE_KEY] as
		| Record<string, unknown>
		| undefined;

	if (saved) {
		const store = app.store as Record<string, unknown>;
		for (const key of Object.keys(saved)) {
			store[key] = saved[key];
		}
	}

	(globalThis as Record<string, unknown>)[STORE_KEY] = app.store;
};

/* HMR plugin for Elysia
   Adds WebSocket endpoint and status endpoint.
   HMR client code is baked into framework index files (React/Svelte/Vue)
   and injected into HTML/HTMX files at build time.
   Also preserves Elysia store state across hot reloads. */
export const hmr = (hmrState: HMRState, manifest: Record<string, string>) => {
	return (app: Elysia) => {
		restoreStore(app);

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
