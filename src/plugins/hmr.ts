import Elysia from 'elysia';
import { UNFOUND_INDEX } from '../constants';
import type { HMRState } from '../dev/clientManager';
import { getMimeType, lookupAsset } from '../dev/assetStore';
import { bridgeReactInternals } from '../react/bridgeInternals';
import {
	handleClientConnect,
	handleClientDisconnect,
	handleHMRMessage
} from '../dev/webSocket';

const STORE_KEY = '__elysiaStore';

/* Preserve Elysia store across bun --hot reloads.
   globalThis survives re-evaluation, so we save the store reference
   before each reload and restore values into the fresh instance. */
const getGlobalValue = (key: string) => Reflect.get(globalThis, key);

const restoreStore = (store: unknown) => {
	const saved = getGlobalValue(STORE_KEY);

	if (saved && typeof saved === 'object') {
		restoreSavedStoreValues(store, saved);
	}

	if (store && typeof store === 'object') {
		Reflect.set(globalThis, STORE_KEY, store);
	}
};

const restoreSavedStoreValues = (store: unknown, saved: object) => {
	if (!store || typeof store !== 'object') {
		return;
	}

	Object.entries(saved).forEach(([key, value]) => {
		Reflect.set(store, key, value);
	});
};

const resolveModuleResponse = (
	moduleResponse: Response,
	ifNoneMatch: string | null
) => {
	const etag = moduleResponse.headers.get('ETag');

	if (etag && ifNoneMatch === etag) {
		return new Response(null, { headers: { ETag: etag }, status: 304 });
	}

	return moduleResponse;
};

const resolveRequestPathname = (request: Request) => {
	const rawUrl = request.url;
	const qIdx = rawUrl.indexOf('?');
	const pathEnd = qIdx === UNFOUND_INDEX ? rawUrl.length : qIdx;
	const pathStart = rawUrl.indexOf('/', rawUrl.indexOf('//') + 2);

	return rawUrl.slice(pathStart, pathEnd);
};

const resolveDevAssetResponse = async (
	request: Request,
	hmrState: HMRState,
	moduleServerHandler?: (
		pathname: string
	) => Promise<Response | undefined> | Response | undefined
) => {
	const pathname = resolveRequestPathname(request);

	if (moduleServerHandler) {
		const moduleResponse = await moduleServerHandler(pathname);

		if (!moduleResponse) return undefined;

		return resolveModuleResponse(
			moduleResponse,
			request.headers.get('If-None-Match')
		);
	}

	const bytes = lookupAsset(hmrState.assetStore, pathname);
	if (!bytes) {
		return undefined;
	}

	return new Response(new Uint8Array(bytes).buffer, {
		headers: {
			'Cache-Control': 'no-cache',
			'Content-Type': getMimeType(pathname)
		}
	});
};

/* HMR plugin for Elysia
   Adds WebSocket endpoint and status endpoint.
   HMR client code is baked into framework index files (React/Svelte/Vue)
   and injected into HTML/HTMX files at build time.
   Also preserves Elysia store state across hot reloads. */
export const hmr = (
	hmrState: HMRState,
	manifest: Record<string, string>,
	moduleServerHandler?: (
		pathname: string
	) => Promise<Response | undefined> | Response | undefined
) =>
	new Elysia({ name: 'absolutejs-hmr' })
		.onStart(({ store }) => {
			restoreStore(store);
		})
		// In HTTP/2 mode, WebSocket is handled by the http2Bridge
		// so we skip Elysia's .ws() registration
		.onBeforeHandle(async ({ request }) => {
			// Bridge React internals if bun install created a duplicate instance.
			// Runs before any route handler so page handlers stay clean.
			if (globalThis.__reactModuleRef) {
				await bridgeReactInternals();
			}

			/* Fast path: only parse URL for requests that could be assets.
				   Asset paths always start with / and contain a dot (extension).
				   Skip API routes, WebSocket upgrades, and page navigations. */
			return resolveDevAssetResponse(
				request,
				hmrState,
				moduleServerHandler
			);
		})
		.get('/@src/*', ({ request }) =>
			resolveDevAssetResponse(request, hmrState, moduleServerHandler)
		)
		.get('/@stub/*', ({ request }) =>
			resolveDevAssetResponse(request, hmrState, moduleServerHandler)
		)
		.get('/@hmr/*', ({ request }) =>
			resolveDevAssetResponse(request, hmrState, moduleServerHandler)
		)
		// Always register WebSocket for HMR. When HTTP/2 bridge is
		// fully implemented it can take over, but Elysia's native
		// WebSocket works fine over both HTTP and HTTPS.
		.ws('/hmr', {
			close: (ws) => handleClientDisconnect(hmrState, ws),
			message: (ws, msg) => handleHMRMessage(hmrState, ws, msg),
			open: (ws) => handleClientConnect(hmrState, ws, manifest)
		})
		.get('/hmr-status', () => ({
			connectedClients: hmrState.connectedClients.size,
			isRebuilding: hmrState.isRebuilding,
			manifestKeys: Object.keys(manifest),
			rebuildCount: hmrState.rebuildCount,
			rebuildQueue: Array.from(hmrState.rebuildQueue),
			timestamp: Date.now()
		}));
