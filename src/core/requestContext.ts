import { AsyncLocalStorage } from 'node:async_hooks';
import { Elysia } from 'elysia';

type AbsoluteRequestStore = {
	request: Request;
	/** Manifest keys `asset()` could not resolve during this request, in
	 *  call order. Dev only — the page handlers use them to find which
	 *  page to build on demand. */
	missingAssets?: string[];
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
	.request(({ request }) => {
		ensureRequestStorage().enterWith({ request });
	})
	.as('global');
export const getCurrentAbsoluteRequest = () =>
	getRequestStorage()?.getStore()?.request;
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
};

export type DeferredPageAssets = {
	/** PascalCase page name the missing keys resolved to. */
	name: string;
	/** The on-demand build did not produce the page (build error). `lookup`
	 *  then yields `''` for every key, so the handler falls through to its
	 *  manifest error — now with the real page name in it. */
	failed: boolean;
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

export const getDevPageWarmer = () => {
	const value = Reflect.get(globalThis, PAGE_WARMER_KEY);

	return isDevPageWarmer(value) ? value : undefined;
};

export const getMissingAssets = () => {
	const missing = getRequestStorage()?.getStore()?.missingAssets;

	return missing ? [...missing] : [];
};

/** Called by `asset()` when a key is missing in dev. */
export const recordMissingAsset = (name: string) => {
	const store = getRequestStorage()?.getStore();
	if (!store) return;
	store.missingAssets ??= [];
	store.missingAssets.push(name);
};

/** Handler miss path. When a page asset came back `''` from `asset()`,
 *  build the page those keys belong to and return accessors for the
 *  fresh manifest values. Returns `null` when the keys are not a deferred
 *  page's (production, `--eager`, no recorded misses, unknown key) and a
 *  `failed` result when the build did not produce the page; either way
 *  the caller falls through to its existing "not found in manifest"
 *  error. */
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
		failed,
		lookup,
		name: described.name
	};

	return assets;
};

export const setDevPageWarmer = (warmer: DevPageWarmer | undefined) => {
	Reflect.set(globalThis, PAGE_WARMER_KEY, warmer);
};

/** Append `<link rel="stylesheet">` tags for the deferred page's CSS to a
 *  `<head>…</head>` string (or head fragment). No-op without hrefs. */
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
