const PREFETCH_CACHE_LIMIT = 16;
const HOVER_DEBOUNCE_MS = 250;

type CacheEntry = {
	url: string;
	promise: Promise<Response>;
};

const cache = new Map<string, CacheEntry>();

const isSlowConnection = () => {
	if (typeof navigator === 'undefined') return false;

	const connection = (
		navigator as Navigator & {
			connection?: { saveData?: boolean };
		}
	).connection;

	return connection?.saveData === true;
};

const prefersReducedData = () => {
	if (typeof window === 'undefined' || !window.matchMedia) return false;

	return window.matchMedia('(prefers-reduced-data: reduce)').matches;
};

const evictOldest = () => {
	const oldest = cache.keys().next();
	if (oldest.done) return;
	cache.delete(oldest.value);
};

/**
 * Prefetch a URL into the in-memory cache. No-op if the user has signalled
 * data-saver / reduced-data, or if the URL is already cached.
 */
export const prefetch = (url: string) => {
	if (typeof fetch === 'undefined') return;
	if (isSlowConnection() || prefersReducedData()) return;
	if (cache.has(url)) return;

	while (cache.size >= PREFETCH_CACHE_LIMIT) evictOldest();

	const promise = fetch(url, { credentials: 'same-origin' }).catch(
		() => new Response(null, { status: 0 })
	);
	cache.set(url, { promise, url });
};

/**
 * Consume a cached prefetch entry on actual navigation, removing it from
 * the cache. Returns the cached Promise<Response> or undefined.
 */
export const consumePrefetch = (url: string) => {
	const entry = cache.get(url);
	if (!entry) return undefined;
	cache.delete(url);

	return entry.promise;
};

export const clearPrefetchCache = () => {
	cache.clear();
};

type HoverHandle = {
	cancel: () => void;
};

/**
 * Wrap a prefetch trigger in a hover-debounce so glancing across many links
 * doesn't fire a fetch storm. The returned handle's `cancel()` aborts the
 * pending hover prefetch (e.g. on `pointerleave`).
 */
export const scheduleHoverPrefetch = (url: string): HoverHandle => {
	if (typeof window === 'undefined') {
		return { cancel: () => {} };
	}

	const timer = window.setTimeout(() => {
		prefetch(url);
	}, HOVER_DEBOUNCE_MS);

	return {
		cancel: () => window.clearTimeout(timer)
	};
};
