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

		if (moduleResponse) {
			return resolveModuleResponse(
				moduleResponse,
				request.headers.get('If-None-Match')
			);
		}
		// Fall through: moduleServerHandler only handles /@src/, /@stub/,
		// /@hmr/ prefixes. Other paths (like /generated/indexes/<hash>.js
		// emitted by HMR rebuilds) need to be served from the asset store —
		// the upstream `staticPlugin({ alwaysStatic: true })` only registers
		// files that existed at server start, so HMR-emitted chunks aren't
		// in those routes.
	}

	const bytes = lookupAsset(hmrState.assetStore, pathname);
	if (bytes) {
		return new Response(new Uint8Array(bytes).buffer, {
			headers: {
				'Cache-Control': 'no-store',
				'Content-Type': getMimeType(pathname)
			}
		});
	}

	// In-memory miss: try disk fallback. The asset store evicts old
	// hashed entries on rebuild (a new chunk replaces the old in
	// memory), but the on-disk file usually still exists for a few
	// rebuild cycles. Browsers often hold HTML referencing an
	// intermediate hash — if that file is on disk, serve it instead
	// of 404'ing.
	const diskBytes = await tryReadFromBuildDir(hmrState, pathname);
	if (diskBytes) {
		// Repopulate the store so future requests for the same hash
		// hit memory. This is bounded by the number of rebuilds in a
		// session and is cleaned up by `cleanStaleAssets`.
		hmrState.assetStore.set(pathname, diskBytes);

		return new Response(new Uint8Array(diskBytes).buffer, {
			headers: {
				'Cache-Control': 'no-store',
				'Content-Type': getMimeType(pathname)
			}
		});
	}

	// Fallback for hashless asset URLs like `/indexes/less-page` (no `.css`,
	// no hash). These can show up briefly when an HMR client tracks a
	// stylesheet by base name and the hash rotated between when the link
	// was rendered and when the request was issued. Redirect to the current
	// hashed path so the browser still gets the right CSS instead of a 404.
	const aliasedTarget = resolveHashlessAlias(hmrState, pathname);
	if (aliasedTarget) {
		return new Response(null, {
			headers: {
				'Cache-Control': 'no-store',
				Location: aliasedTarget
			},
			status: 302
		});
	}

	return undefined;
};

/* Attempt to read `<buildDir>/<pathname>` from disk for a hashed
 * asset URL that's no longer in the in-memory store. Returns null
 * on read error (file not found, outside buildDir, etc.). */
const tryReadFromBuildDir = async (hmrState: HMRState, pathname: string) => {
	const buildDir = hmrState.resolvedPaths?.buildDir;
	if (!buildDir) return null;
	if (!pathname.startsWith('/')) return null;
	const { resolve, normalize } = await import('node:path');
	const candidate = resolve(buildDir, pathname.slice(1));
	const normalizedBuild = normalize(buildDir);
	// Path-traversal guard — the URL path is user-controlled.
	if (!candidate.startsWith(normalizedBuild)) return null;
	try {
		return await Bun.file(candidate).bytes();
	} catch {
		return null;
	}
};

const HASHLESS_INDEX_PATH_PATTERN = /^(\/[^/]+)?\/indexes\/([^/.]+)\/?$/;

/* If the pathname looks like `/indexes/<base>` (or `/<framework>/indexes/<base>`)
   with no extension, look for an asset whose path prefix matches and return
   that path. Returns null if there's no match — caller falls back to 404. */
const resolveHashlessAlias = (hmrState: HMRState, pathname: string) => {
	const match = pathname.match(HASHLESS_INDEX_PATH_PATTERN);
	if (!match) return null;
	const prefix = `${match[1] ?? ''}/indexes/${match[2]}.`;
	for (const candidate of hmrState.assetStore.keys()) {
		if (candidate.startsWith(prefix)) return candidate;
	}

	return null;
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
		// `onRequest` (not `onBeforeHandle`) is required: HMR-emitted chunks
		// like /generated/indexes/<hash>.js have no matching Elysia route
		// (the upstream `staticPlugin({ alwaysStatic })` only registers
		// files that existed at server start, so anything emitted by HMR
		// later is unrouted). `onBeforeHandle` only fires when a route
		// matches, so it would never see those requests; `onRequest` fires
		// before routing and lets us serve them from the asset store.
		.onRequest(async ({ request }) => {
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
		// SURGICAL_HMR §3.2 — Angular component metadata HMR endpoint.
		// Angular's `_HmrLoad` listener (baked into compiled component
		// .js by the AOT pipeline with `enableHmr: true`) calls
		// `import(ɵɵgetReplaceMetadataURL(id, t, import.meta.url))` to
		// fetch this. The default export is the
		// `${ClassName}_UpdateMetadata` callback that
		// `ɵɵreplaceMetadata` runs against the LIVE class — see
		// docs/ABSOLUTEJS_ANGULAR_HMR.md for the architecture.
		// Wildcard `/@ng/*` (rather than exact `/@ng/component`)
		// because Elysia's tree router doesn't match exact paths
		// reliably when the leading segment starts with `@` —
		// the working `/@src/*`, `/@hmr/*`, `/@stub/*` neighbours
		// are all wildcards too. We parse the sub-path here.
		.get('/@ng/*', async ({ request, query }) => {
			const url = new URL(request.url);
			const subPath = url.pathname.slice('/@ng/'.length);

			if (subPath === 'component') {
				const id = typeof query.c === 'string' ? query.c : null;
				if (!id) {
					return new Response('Missing ?c=<id>', { status: 400 });
				}
				const { getApplyMetadataModule } = await import(
					'../dev/angular/hmrCompiler'
				);
				const module = await getApplyMetadataModule(id);
				if (module === null) {
					return new Response(
						`No HMR module for id=${id}. The component may not be in the current program, or the program isn't built yet (rebuild on first save).`,
						{ status: 404 }
					);
				}

				// Rewrite bare module specifiers (e.g. `from 'rxjs'`)
				// to dev-vendor URLs (`/vendor/rxjs.js`). The surgical
				// module's `_Fresh` class methods rely on those imports
				// for symbols like `combineLatest` to be in module
				// scope when the prototype-patched method later runs
				// (Tier 1a remount fires init hooks on a fresh
				// instance, which surfaces these references).
				// Merge all three vendor-path stores so the rewriter
				// can resolve any bare specifier the surgical
				// module's preserved imports might use:
				//   • `getDevVendorPaths()` — React/general deps
				//   • `getAngularVendorPaths()` — `@angular/*` paths
				//   • `globalThis.__depVendorPaths` — non-Angular
				//     transitive deps like `rxjs`, `lodash`, etc.
				//     (built by `buildDepVendor.ts` and stashed on
				//     globalThis for cross-plugin access)
				const { getDevVendorPaths, getAngularVendorPaths } =
					await import('../core/devVendorPaths');
				const { rewriteImportsInContent } = await import(
					'../build/rewriteImportsPlugin'
				);
				const depVendorPaths =
					(
						globalThis as unknown as {
							__depVendorPaths?: Record<string, string>;
						}
					).__depVendorPaths ?? {};
				const vendorPaths = {
					...(getDevVendorPaths() ?? {}),
					...(getAngularVendorPaths() ?? {}),
					...depVendorPaths
				};
				const rewritten = rewriteImportsInContent(module, vendorPaths);

				return new Response(rewritten, {
					headers: {
						'Cache-Control': 'no-store',
						'Content-Type': 'text/javascript; charset=utf-8'
					}
				});
			}

			return new Response('Unknown @ng route', { status: 404 });
		})
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
