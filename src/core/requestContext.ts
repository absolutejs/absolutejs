import { AsyncLocalStorage } from 'node:async_hooks';
import { Elysia } from 'elysia';
import { buildErrorPage } from '../utils/ssrErrorPage';
import { requestIdFor, requestIdHeader } from './requestId';

/** A cookie waiting to be sent: the header line, and what a read of the
 *  same name later in this request should report (`undefined` once it
 *  has been deleted). */
export type QueuedCookie = {
	name: string;
	serialized: string;
	value: string | undefined;
};

export type AbsoluteRequestStore = {
	request: Request;
	/** This request's correlation id, computed on first use. Nothing
	 *  computes it up front: `onRequest` runs for every request and most
	 *  requests never ask, so reading a header and minting a UUID there
	 *  would be a cost on the hot path paid by everyone for a feature that
	 *  is opt-in. */
	requestId?: string;
	/** Route pattern Elysia matched for this request (e.g. `/portal/*`).
	 *  Set before the handler runs, for dynamic routes only. */
	route?: string;
	/** Manifest keys `asset()` could not resolve during this request, in
	 *  call order. Dev only — the page handlers use them to find which
	 *  page to build on demand. */
	/** The client entry this page will load, recorded by whichever
	 *  framework handler resolved it. Read on the way out to preload the
	 *  modules that entry imports — see `src/build/modulePreload.ts` for
	 *  why the browser cannot discover them in time on its own. */
	pageEntry?: string;
	missingAssets?: string[];
	/** `useServerData` results from Vue ISLANDS rendered during this
	 *  request. A Vue page has its own collector; an island on a React,
	 *  Svelte or HTML page had none, so its data was never prefetched on
	 *  the server. Collected here because several islands share one page
	 *  and one payload. */
	vueIslandServerData?: unknown;
	/** The request's cookies, parsed on first use by `cookies()`. */
	requestCookies?: Map<string, string>;
	/** `Set-Cookie` lines queued by `cookies()`, keyed by what a browser
	 *  treats as one cookie, so setting a name twice sends the last. */
	responseCookies?: Map<string, QueuedCookie>;
	/** True once this request's response has been handed over: a cookie
	 *  set after that has no header left to travel in. */
	responseStarted?: boolean;
	/** Tags `cacheTag()` declared while this request was rendered. */
	cacheTags?: Set<string>;
	/** What `headers()` and `cookies()` read while this request was
	 *  rendered, when it is a pre-render (cacheTags.ts). */
	requestReads?: Set<string>;
	/** Whether this request is a pre-render, worked out once. */
	isPrerenderCapture?: boolean;
};
type AbsoluteRequestStorage = AsyncLocalStorage<AbsoluteRequestStore>;

const REQUEST_STORAGE_KEY = Symbol.for('absolutejs.requestAsyncLocalStorage');
const PAGE_WARMER_KEY = Symbol.for('absolutejs.devPageWarmer');

const isAbsoluteRequestStorage = (
	value: unknown
): value is AbsoluteRequestStorage =>
	typeof value === 'object' &&
	value !== null &&
	'getStore' in value &&
	typeof value.getStore === 'function' &&
	'run' in value &&
	typeof value.run === 'function';

const getRequestStorage = () => {
	const value = Reflect.get(globalThis, REQUEST_STORAGE_KEY);

	return isAbsoluteRequestStorage(value) ? value : undefined;
};

const ensureRequestStorage = () => {
	const existing = getRequestStorage();
	if (existing) return existing;

	const storage = new AsyncLocalStorage<AbsoluteRequestStore>();
	Reflect.set(globalThis, REQUEST_STORAGE_KEY, storage);

	return storage;
};

export const absoluteRequestContext = new Elysia({
	name: 'absolutejs-request-context'
})
	.onRequest(({ request }) => {
		ensureRequestStorage().enterWith({ request });
	})
	.onBeforeHandle(({ request, route }) => {
		const store = getRequestStorage()?.getStore();
		if (store && store.request === request && typeof route === 'string') {
			store.route = route;
		}
	})
	/* Cookies queued by `cookies().set()` leave here. `mapResponse` is
	 * the hook that sees every way a response is produced — a returned
	 * value, a `Response`, a redirect, another plugin answering early —
	 * and it runs before any of them is sent. */
	.mapResponse(({ request, responseValue, set }) => {
		const store = getRequestStorage()?.getStore();
		if (!store || store.request !== request) return;
		store.responseStarted = true;
		const queued = [...(store.responseCookies?.values() ?? [])].map(
			(cookie) => cookie.serialized
		);
		if (queued.length === 0) return;
		if (responseValue instanceof Response) {
			queued.forEach((cookie) => {
				responseValue.headers.append('set-cookie', cookie);
			});

			return;
		}
		// Appended to, never replaced: a route's own `cookie.x.set()`
		// and an earlier hook's header are in here too.
		const existing: unknown = set.headers['set-cookie'];
		const kept = Array.isArray(existing)
			? existing.filter((value) => typeof value === 'string')
			: [];
		const single = typeof existing === 'string' ? [existing] : [];
		Reflect.set(set.headers, 'set-cookie', [...kept, ...single, ...queued]);
	})
	.as('global');
/** @internal The current request's store, for the request helpers. */
export const getAbsoluteRequestStore = () => getRequestStorage()?.getStore();
export const getCurrentAbsoluteRequest = () =>
	getRequestStorage()?.getStore()?.request;
/** The Elysia route pattern matched for the current request, when the
 *  request is the one given (or no request is given). Lets page handlers
 *  derive mount-relative values such as Angular's `APP_BASE_HREF` at
 *  request time, wherever the handler call is written. */
export const getCurrentAbsoluteRoute = (request?: Request) => {
	const store = getRequestStorage()?.getStore();
	if (!store) return undefined;
	if (request && store.request !== request) return undefined;

	return store.route;
};
/** This request's correlation id — the inbound one when a proxy sent a
 *  usable one, else a new one — or undefined outside a request.
 *
 *  Memoized per request, so the id in a log line, the one on the response
 *  header and the one an error report quotes are the same string however
 *  many times it is asked for. `header` is only read the first time. */
export const getCurrentRequestId = (header: string = requestIdHeader()) => {
	const store = getRequestStorage()?.getStore();
	if (!store) return undefined;
	store.requestId ??= requestIdFor(store.request, header);

	return store.requestId;
};
export const runWithAbsoluteRequest = <Result>(
	request: Request,
	callback: () => Result
) => ensureRequestStorage().run({ request }, callback);

/* ---------------------------------------------------------------------
 * Dev on-demand pages.
 *
 * `absolute dev` builds a page the first time someone asks for it. The
 * route's `asset(manifest, 'PortalIndex')` call runs before the handler
 * and yields `''` for an unbuilt page; the handler then needs to know
 * which key was asked for so it can build that page and re-read the
 * manifest. `asset()` records the miss on the request's async context,
 * and the handler resolves it through the warmer the dev server
 * registered on `globalThis` (keyed by `Symbol.for`, so the user's server
 * bundle and the framework runtime share one instance even when they
 * load separate module copies). Production never registers a warmer, so
 * every helper below is a no-op there.
 * ------------------------------------------------------------------- */

export type DevPageWarmStatus = 'built' | 'failed' | 'ready' | 'unknown';

export type DevPageWarmer = {
	/** Map a manifest key (or page source path) to its page. `built` says
	 *  whether that page's bundle already exists in the manifest. */
	describe: (key: string) => { name: string; built: boolean } | undefined;
	/** Build the page a key belongs to (deduped per page) and resolve once
	 *  its manifest entries exist. */
	warm: (key: string) => Promise<DevPageWarmStatus>;
	/** Current manifest value for a key, after a warm. */
	lookup: (key: string) => string | undefined;
	/** The error the last failed page build reported, if any. */
	lastError?: () => string | undefined;
};

export type DeferredPageAssets = {
	/** PascalCase page name the missing keys resolved to. */
	name: string;
	/** The on-demand build did not produce the page (build error). `lookup`
	 *  then yields `''` for every key, so the handler falls through to its
	 *  manifest error — now with the real page name in it. */
	failed: boolean;
	/** What the failed build reported (`undefined` when it built). */
	error: string | undefined;
	/** Manifest value for a key after the build (`''` when still absent). */
	lookup: (key: string) => string;
	/** Stylesheet hrefs for the CSS keys that went missing during this
	 *  request and exist now. The route already rendered its `<head>` with
	 *  `''` for them, so the handler links them in itself for this first
	 *  response; every later request resolves them through `asset()`. */
	cssHrefs: () => string[];
};

const CSS_KEY_RE = /(?:CSS|Css)$/;

const isDevPageWarmer = (value: unknown): value is DevPageWarmer =>
	typeof value === 'object' &&
	value !== null &&
	'describe' in value &&
	typeof value.describe === 'function' &&
	'warm' in value &&
	typeof value.warm === 'function' &&
	'lookup' in value &&
	typeof value.lookup === 'function';

export const devBuildErrorResponse = (
	framework: string,
	assets: DeferredPageAssets | null
) => {
	if (!assets?.failed) return null;

	return new Response(buildErrorPage(framework, assets.name, assets.error), {
		headers: {
			'cache-control': 'no-store',
			'content-type': 'text/html; charset=utf-8'
		},
		status: 500
	});
};
export const getDevPageWarmer = () => {
	const value = Reflect.get(globalThis, PAGE_WARMER_KEY);

	return isDevPageWarmer(value) ? value : undefined;
};
export const getMissingAssets = () => {
	const missing = getRequestStorage()?.getStore()?.missingAssets;

	return missing ? [...missing] : [];
};
/** The client entry recorded for this request, if a page handler ran. */
export const getPageEntry = () => getRequestStorage()?.getStore()?.pageEntry;

/** The request's Vue island collector, created on first use. Returns
 *  undefined outside a request, where there is nothing to attach a
 *  payload to anyway. */
export const getVueIslandServerData = (create: () => unknown) => {
	const store = getRequestStorage()?.getStore();
	if (!store) return undefined;
	store.vueIslandServerData ??= create();

	return store.vueIslandServerData;
};

/** The request's Vue island collector if one was created, without
 *  creating it: the page context asks on every page, and a page with no
 *  Vue islands should not grow one. */
export const peekVueIslandServerData = () =>
	getRequestStorage()?.getStore()?.vueIslandServerData;

export const recordMissingAsset = (name: string) => {
	const store = getRequestStorage()?.getStore();
	if (!store) return;
	store.missingAssets ??= [];
	store.missingAssets.push(name);
};
export const resolveDeferredPageAssets = async () => {
	const warmer = getDevPageWarmer();
	if (!warmer) return null;
	const missing = getMissingAssets();
	const pageKey = missing.find((key) => warmer.describe(key));
	if (pageKey === undefined) return null;
	const described = warmer.describe(pageKey);
	if (!described) return null;
	const status = await warmer.warm(pageKey);
	// A failed build still resolves the page name so the handler's manifest
	// error names the page (the build's own error is in the terminal and
	// the overlay); `lookup` yields `''` for every key.
	const failed = status === 'failed' || status === 'unknown';

	const lookup = (key: string) => (failed ? '' : (warmer.lookup(key) ?? ''));
	const cssKeys = missing.filter((key) => CSS_KEY_RE.test(key));
	const cssHrefs = () =>
		cssKeys
			.map(lookup)
			.filter((href) => href.length > 0 && href.startsWith('/'));
	const assets: DeferredPageAssets = {
		cssHrefs,
		error: failed ? warmer.lastError?.() : undefined,
		failed,
		lookup,
		name: described.name
	};

	return assets;
};
export const setDevPageWarmer = (warmer: DevPageWarmer | undefined) => {
	Reflect.set(globalThis, PAGE_WARMER_KEY, warmer);
};
/** Records the client entry this page will load. Called where each
 *  framework resolves its index, which is the only place that knows it
 *  before the response starts — a streamed page has already sent its
 *  headers by the time the markup exists. */
export const setPageEntry = (entry: string) => {
	const store = getRequestStorage()?.getStore();
	if (store) store.pageEntry = entry;
};

export const withDeferredStylesheets = (
	head: string,
	assets: DeferredPageAssets | null
) => {
	const hrefs = assets?.cssHrefs() ?? [];
	if (hrefs.length === 0) return head;
	const links = hrefs
		.filter((href) => !head.includes(href))
		.map((href) => `<link rel="stylesheet" href="${href}">`)
		.join('');
	if (links.length === 0) return head;
	const headClose = /<\/head\s*>/i.exec(head);

	return headClose
		? head.slice(0, headClose.index) + links + head.slice(headClose.index)
		: head + links;
};
