/**
 * Framework-neutral navigation prefetch primitive.
 *
 * Pure DOM + `fetch` — no framework imports — so the React, Vue and Svelte
 * `<Link>` components (and user code) share one cache, one in-flight
 * budget, one IntersectionObserver and one set of data-saver guards.
 *
 *   import { prefetch, speculate } from '@absolutejs/absolute/client/prefetch';
 *
 * What a prefetch buys the click that follows:
 *  - `'document'` — the HTML lands in the browser's HTTP cache (pages
 *    carry a content-hash `ETag`), so the real navigation revalidates
 *    with a 304 instead of re-rendering.
 *  - `'module'`   — `<link rel="modulepreload">` parses + compiles the
 *    client module graph ahead of time.
 *  - `'data'`     — the route-data payload
 *    (`application/vnd.absolute.route+json`): the page's props plus the
 *    client entry and stylesheets it needs, which are `modulepreload`ed
 *    / prefetched as the payload lands. A 404 / 406 from a server that
 *    doesn't speak route data is remembered as "no data".
 *  - `'route'`    — `'document'` + `'data'`, i.e. everything a click
 *    needs. What a `<Link>` warms on hover / pointerdown.
 *  - `speculate()` — a prerender speculation rule; the browser renders
 *    the whole target page in a hidden tab so the click is instant.
 *
 * Global opt-out: `window.__ABSOLUTE_PREFETCH__ = false` disables every
 * entry point in this module (useful for analytics-sensitive pages).
 */
import type {
	HoverPrefetchHandle,
	HoverPrefetchOptions,
	PrefetchKind,
	PrefetchOptions
} from '../../types/prefetch';

const PREFETCH_CACHE_LIMIT = 16;
const HOVER_DEBOUNCE_MS = 250;
const MAX_IN_FLIGHT = 2;
const MAX_LIVE_SPECULATION_RULES = 2;
const VIEWPORT_ROOT_MARGIN = '128px';
const SLOW_EFFECTIVE_TYPES = new Set(['slow-2g', '2g']);
const NOT_FOUND = 404;
const NOT_ACCEPTABLE = 406;

export const ROUTE_DATA_MEDIA_TYPE = 'application/vnd.absolute.route+json';

type CacheEntry = {
	abort: () => void;
	kind: PrefetchKind;
	promise: Promise<Response>;
	url: string;
};

type QueuedTask = {
	cancelled: boolean;
	start: () => void;
};

const cache = new Map<string, CacheEntry>();
const queue: QueuedTask[] = [];
let inFlight = 0;

const preloadedModules = new Set<string>();
const prefetchedStyles = new Set<string>();
const liveSpeculationRules = new Map<string, HTMLScriptElement>();

const offlineResponse = () => new Response(null, { status: 0 });

/** `'route'` is a compound trigger, not a cache entry of its own: it
 *  warms the `'document'` and `'data'` entries, so lookups for it read
 *  the document it warmed. */
const storageKind = (kind: PrefetchKind) =>
	kind === 'route' ? 'document' : kind;

const cacheKey = (kind: PrefetchKind, url: string) =>
	`${storageKind(kind)}:${url}`;

const resolveHref = (url: string) => {
	if (typeof window === 'undefined') return url;

	try {
		return new URL(url, window.location.href).href;
	} catch {
		return url;
	}
};

/* ------------------------------------------------------------------ */
/* Guards                                                              */
/* ------------------------------------------------------------------ */

const isGloballyDisabled = () =>
	typeof window !== 'undefined' &&
	Reflect.get(window, '__ABSOLUTE_PREFETCH__') === false;

const isSlowConnection = () => {
	if (typeof navigator === 'undefined') return false;

	const connection = Reflect.get(navigator, 'connection');
	if (typeof connection !== 'object' || connection === null) return false;
	if (Reflect.get(connection, 'saveData') === true) return true;

	const effectiveType = Reflect.get(connection, 'effectiveType');

	return (
		typeof effectiveType === 'string' &&
		SLOW_EFFECTIVE_TYPES.has(effectiveType)
	);
};

const prefersReducedData = () => {
	if (typeof window === 'undefined' || !window.matchMedia) return false;

	return window.matchMedia('(prefers-reduced-data: reduce)').matches;
};

/** `true` when prefetching is allowed right now: we're in a browser, the
 *  page hasn't opted out via `window.__ABSOLUTE_PREFETCH__ = false`, and
 *  the user hasn't asked for less data (Save-Data, 2g, reduced-data). */
export const canPrefetch = () =>
	typeof window !== 'undefined' &&
	!isGloballyDisabled() &&
	!isSlowConnection() &&
	!prefersReducedData();

const readNodeEnv = () => {
	// Deliberately not the bare `process.env.NODE_ENV` member expression:
	// bundlers substitute that at build time, which would bake this
	// package's own build environment into the shipped client entry. In a
	// browser `process` is undefined and this yields `undefined`.
	const processLike = Reflect.get(globalThis, 'process');
	if (typeof processLike !== 'object' || processLike === null) {
		return undefined;
	}
	const env = Reflect.get(processLike, 'env');
	if (typeof env !== 'object' || env === null) return undefined;
	const value = Reflect.get(env, 'NODE_ENV');

	return typeof value === 'string' ? value : undefined;
};

/** Whether the page was served by the AbsoluteJS dev server. The HMR
 *  client is only injected in dev, so its markers are the reliable
 *  signal; `NODE_ENV` is the fallback for environments that bundle
 *  without the dev server (tests, custom hosts). */
export const isDevelopmentClient = () => {
	if (typeof window === 'undefined') return false;
	if (Reflect.get(window, '__HMR_FRAMEWORK__') !== undefined) return true;
	if (Reflect.get(window, '__HMR_WS__') !== undefined) return true;
	if (
		typeof document !== 'undefined' &&
		document.querySelector('script[data-hmr-client]') !== null
	) {
		return true;
	}

	return readNodeEnv() === 'development';
};

/** Same-origin, non-hash, http(s) URL — the only kind worth prefetching. */
export const isPrefetchableHref = (href: string) => {
	if (typeof window === 'undefined') return false;
	if (href === '' || href.startsWith('#')) return false;

	try {
		const url = new URL(href, window.location.href);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

		return url.origin === window.location.origin;
	} catch {
		return false;
	}
};

/** Production → `'viewport'` (viewport + hover). Development → `'hover'`
 *  only, so a page full of links doesn't fan out into the dev server. */
export const resolveDefaultPrefetchMode = () =>
	isDevelopmentClient() ? 'hover' : 'viewport';

/* ------------------------------------------------------------------ */
/* In-flight budget                                                    */
/* ------------------------------------------------------------------ */

const runQueue = () => {
	while (inFlight < MAX_IN_FLIGHT) {
		const next = queue.shift();
		if (!next) return;
		if (next.cancelled) continue;
		next.start();
	}
};

const finishTask = () => {
	inFlight = Math.max(0, inFlight - 1);
	runQueue();
};

/** Run `task` when one of the `MAX_IN_FLIGHT` slots frees up. The
 *  returned promise never rejects — network failures resolve to a
 *  status-0 response so consumers can treat "no prefetch" uniformly. */
const runWhenReleased = async (
	gate: Promise<void>,
	task: (signal: AbortSignal) => Promise<Response>,
	signal: AbortSignal
) => {
	await gate;
	try {
		return await task(signal);
	} catch {
		return offlineResponse();
	} finally {
		finishTask();
	}
};

const enqueue = (task: (signal: AbortSignal) => Promise<Response>) => {
	const controller = new AbortController();
	let release: () => void = () => undefined;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const queued: QueuedTask = {
		cancelled: false,
		start: () => {
			// Count the slot synchronously so `runQueue` can't overshoot the
			// budget while the async runner is still waiting on the gate.
			inFlight += 1;
			release();
		}
	};
	const promise = runWhenReleased(gate, task, controller.signal);
	queue.push(queued);
	runQueue();

	const abort = () => {
		if (queued.cancelled) return;
		queued.cancelled = true;
		controller.abort();
	};

	return { abort, promise };
};

/* ------------------------------------------------------------------ */
/* Cache                                                               */
/* ------------------------------------------------------------------ */

const evictOldest = () => {
	const oldest = cache.keys().next();
	if (oldest.done) return;
	cache.get(oldest.value)?.abort();
	cache.delete(oldest.value);
};

const touch = (key: string, entry: CacheEntry) => {
	// Re-insert so Map iteration order doubles as LRU recency.
	cache.delete(key);
	cache.set(key, entry);
};

export const clearPrefetchCache = () => {
	for (const entry of cache.values()) entry.abort();
	cache.clear();
};

/** Take the prefetched response for `url` out of the cache. Returns
 *  `undefined` when nothing was prefetched (or it was evicted). Callers
 *  that fetch the same URL themselves can await this instead. */
export const consumePrefetch = (url: string, kind: PrefetchKind = 'document') => {
	const key = cacheKey(kind, url);
	const entry = cache.get(key);
	if (!entry) return undefined;
	cache.delete(key);

	return entry.promise;
};

/** Whether `url` is already prefetched (in flight, queued or settled). */
export const hasPrefetched = (url: string, kind: PrefetchKind = 'document') =>
	cache.has(cacheKey(kind, url));

/* ------------------------------------------------------------------ */
/* Kinds                                                               */
/* ------------------------------------------------------------------ */

const injectLink = (rel: string, href: string, asType?: string) => {
	if (typeof document === 'undefined') return;
	const link = document.createElement('link');
	link.rel = rel;
	link.href = href;
	if (asType) link.setAttribute('as', asType);
	document.head.append(link);
};

/** Without `fetch` (very old engines) fall back to a `<link rel="prefetch">`
 *  for documents; other kinds have no declarative equivalent. */
const injectPrefetchFallback = (kind: PrefetchKind, url: string) => {
	if (kind !== 'document' || !supportsLinkRel('prefetch')) return;
	injectLink('prefetch', url, 'document');
};

const supportsLinkRel = (rel: string) => {
	if (typeof document === 'undefined') return false;
	const link = document.createElement('link');

	return (
		typeof link.relList?.supports === 'function' &&
		link.relList.supports(rel)
	);
};

/** Inject `<link rel="prefetch" as="style">` once per resolved href, so
 *  the target page's stylesheets are in the HTTP cache before the click.
 *  `prefetch` rather than `preload`: the sheet is for the NEXT document,
 *  so preloading it would warn about an unused preload on this one. */
export const prefetchStylesheet = (href: string) => {
	if (typeof document === 'undefined') return false;
	const resolved = resolveHref(href);
	if (prefetchedStyles.has(resolved)) return false;
	prefetchedStyles.add(resolved);
	// No `relList.supports` gate: a browser that doesn't know `prefetch`
	// simply ignores the tag, and there is no fallback worth branching to.
	injectLink('prefetch', href, 'style');

	return true;
};

/** Inject `<link rel="modulepreload">` once per resolved href. Returns
 *  `true` when a new tag was added. */
export const preloadModule = (href: string) => {
	if (typeof document === 'undefined') return false;
	const resolved = resolveHref(href);
	if (preloadedModules.has(resolved)) return false;

	const existing = Array.from(
		document.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"]')
	);
	if (existing.some((link) => resolveHref(link.href) === resolved)) {
		preloadedModules.add(resolved);

		return false;
	}

	preloadedModules.add(resolved);
	injectLink('modulepreload', href);

	return true;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isHref = (value: unknown): value is string =>
	typeof value === 'string' && value.length > 0;

/** Warm what a route-data envelope points at: `modulepreload` for the
 *  page's client entry (and a separate client module when it has one),
 *  `<link rel="prefetch">` for its stylesheets. Anything unexpected in
 *  the payload is ignored — a prefetch must never break a page. */
const warmRouteDataAssets = (envelope: unknown) => {
	if (!isRecord(envelope)) return;
	const { assets } = envelope;
	if (!isRecord(assets)) return;
	const { client, css, index } = assets;
	for (const href of [index, client].filter(isHref)) preloadModule(href);
	if (!Array.isArray(css)) return;
	for (const href of css.filter(isHref)) prefetchStylesheet(href);
};

/** Read the envelope out of a clone so the cached response body is still
 *  unconsumed for whoever calls `consumePrefetch`. */
const warmFromRouteData = async (response: Response) => {
	try {
		warmRouteDataAssets(await response.clone().json());
	} catch {
		/* malformed payload — the document prefetch still stands */
	}

	return response;
};

const fetchDocument = (url: string, signal: AbortSignal) =>
	fetch(url, { credentials: 'same-origin', signal });

const fetchRouteData = async (url: string, signal: AbortSignal) => {
	const response = await fetch(url, {
		credentials: 'same-origin',
		headers: { Accept: ROUTE_DATA_MEDIA_TYPE },
		signal
	});
	const contentType = response.headers.get('content-type') ?? '';
	const isRouteData =
		response.ok && contentType.includes(ROUTE_DATA_MEDIA_TYPE);
	if (isRouteData) return warmFromRouteData(response);

	// The server doesn't speak route data (yet) — 404 / 406 / HTML fallback.
	// Remember that as "no data" so the URL isn't asked again, and drain
	// the body so the connection can be reused.
	await response.body?.cancel().catch(() => undefined);
	const status =
		response.status === NOT_FOUND || response.status === NOT_ACCEPTABLE
			? response.status
			: NOT_ACCEPTABLE;

	return new Response(null, { status });
};

/**
 * Prefetch `url`. No-op when the user signalled data-saver / reduced-data
 * / 2g, when the page opted out, or when the URL is already cached. At
 * most two prefetches are in flight at once; the rest queue in order.
 */
export const prefetch = (url: string, options: PrefetchOptions = {}) => {
	const kind = options.kind ?? 'document';
	if (!canPrefetch()) return;

	if (kind === 'module') {
		preloadModule(url);

		return;
	}

	// `'route'` is document + data: the HTML for the navigation itself and
	// the payload that names the modules and CSS to warm alongside it.
	if (kind === 'route') {
		prefetch(url, { kind: 'document' });
		prefetch(url, { kind: 'data' });

		return;
	}

	const key = cacheKey(kind, url);
	const existing = cache.get(key);
	if (existing) {
		touch(key, existing);

		return;
	}

	if (typeof fetch === 'undefined') {
		injectPrefetchFallback(kind, url);

		return;
	}

	while (cache.size >= PREFETCH_CACHE_LIMIT) evictOldest();

	const { abort, promise } = enqueue((signal) =>
		kind === 'data' ? fetchRouteData(url, signal) : fetchDocument(url, signal)
	);
	cache.set(key, { abort, kind, promise, url });
};

/* ------------------------------------------------------------------ */
/* Speculation rules                                                   */
/* ------------------------------------------------------------------ */

const supportsSpeculationRules = () =>
	typeof HTMLScriptElement !== 'undefined' &&
	typeof HTMLScriptElement.supports === 'function' &&
	HTMLScriptElement.supports('speculationrules');

/**
 * Ask the browser to prerender `url` right away via a speculation-rules
 * script. Deduped per URL and capped to two live rules — the oldest is
 * removed when a third arrives, so a hover trail can't pile up hidden
 * prerendered tabs. Silently no-ops where the API is unsupported.
 */
export const speculate = (url: string) => {
	if (!canPrefetch() || !supportsSpeculationRules()) return false;
	if (typeof document === 'undefined') return false;

	const resolved = resolveHref(url);
	if (liveSpeculationRules.has(resolved)) return false;

	while (liveSpeculationRules.size >= MAX_LIVE_SPECULATION_RULES) {
		const oldest = liveSpeculationRules.keys().next();
		if (oldest.done) break;
		liveSpeculationRules.get(oldest.value)?.remove();
		liveSpeculationRules.delete(oldest.value);
	}

	const script = document.createElement('script');
	script.type = 'speculationrules';
	script.textContent = JSON.stringify({
		prerender: [{ eagerness: 'immediate', urls: [url] }]
	});
	document.head.append(script);
	liveSpeculationRules.set(resolved, script);

	return true;
};

/* ------------------------------------------------------------------ */
/* Triggers                                                            */
/* ------------------------------------------------------------------ */

const noopHandle: HoverPrefetchHandle = {
	cancel: () => {
		/* nothing scheduled */
	}
};

/**
 * Wrap a prefetch trigger in a hover-debounce so glancing across many links
 * doesn't fire a fetch storm. The returned handle's `cancel()` aborts the
 * pending hover prefetch (e.g. on `pointerleave`).
 *
 * Defaults to `kind: 'route'` — a hover is deliberate enough to be worth
 * the document AND the route data (and the modules + CSS that payload
 * names). Viewport prefetching stays document-only.
 */
export const scheduleHoverPrefetch = (
	url: string,
	options: HoverPrefetchOptions = {}
): HoverPrefetchHandle => {
	if (typeof window === 'undefined') return noopHandle;

	const timer = window.setTimeout(() => {
		prefetch(url, { kind: options.kind ?? 'route' });
		if (options.prerender) speculate(url);
	}, HOVER_DEBOUNCE_MS);

	return {
		cancel: () => window.clearTimeout(timer)
	};
};

type ViewportTarget = {
	options: PrefetchOptions;
	url: string;
};

const viewportTargets = new WeakMap<Element, ViewportTarget>();
let viewportObserver: IntersectionObserver | null = null;

const handleIntersections = (entries: IntersectionObserverEntry[]) => {
	for (const entry of entries) {
		if (!entry.isIntersecting) continue;
		const target = viewportTargets.get(entry.target);
		viewportObserver?.unobserve(entry.target);
		viewportTargets.delete(entry.target);
		if (target) prefetch(target.url, target.options);
	}
};

const getViewportObserver = () => {
	if (viewportObserver) return viewportObserver;
	if (typeof IntersectionObserver === 'undefined') return null;
	viewportObserver = new IntersectionObserver(handleIntersections, {
		rootMargin: VIEWPORT_ROOT_MARGIN
	});

	return viewportObserver;
};

/**
 * Prefetch `url` once `element` scrolls within 128px of the viewport. One
 * IntersectionObserver is shared by every link on the page. Returns an
 * unobserve function for the caller's unmount hook.
 */
export const observeViewport = (
	element: Element,
	url: string,
	options: PrefetchOptions = {}
) => {
	const observer = getViewportObserver();
	if (!observer || !canPrefetch()) return () => undefined;

	viewportTargets.set(element, { options, url });
	observer.observe(element);

	return () => {
		observer.unobserve(element);
		viewportTargets.delete(element);
	};
};

/** Test / teardown helper — forgets injected modulepreload + speculation
 *  rule bookkeeping and cancels any queued fetches. */
export const resetPrefetchState = () => {
	clearPrefetchCache();
	queue.length = 0;
	preloadedModules.clear();
	prefetchedStyles.clear();
	for (const script of liveSpeculationRules.values()) script.remove();
	liveSpeculationRules.clear();
	viewportObserver?.disconnect();
	viewportObserver = null;
};
