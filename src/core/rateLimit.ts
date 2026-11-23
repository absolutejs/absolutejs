/* A fixed-window rate limiter, and the question of what to count by.
 *
 * Two things make this more than a counter in a Map.
 *
 * The key. A limiter keyed on something the client chooses is not a
 * limiter: if `x-forwarded-for` were trusted by default, a client sending a
 * fresh value per request would get a fresh bucket per request and every
 * limit here would be decoration. So the key is the connection address
 * (`server.requestIP`), and the forwarded header is consulted ONLY when
 * the app says it is behind a proxy that sets it. That is the opposite
 * default from `isHttpsRequest`, which may trust its header because
 * spoofing it can only ever turn `Secure` ON — here spoofing would turn
 * enforcement off, so the trust has to be stated.
 *
 * The memory. One bucket per key, and an attacker picks the keys: behind a
 * proxy with `trustProxy`, or simply from a botnet, keys rotate without
 * limit, and an unbounded Map makes the limiter itself the exhaustion
 * vector it was added to prevent. So the store is capped and evicts, which
 * is the part worth testing.
 *
 * Pure: a clock and a key in, a decision out. The plugin does the HTTP. */

/** Buckets held before the oldest are evicted. 10k keys of a window start
 *  and a count is tens of kilobytes; the cap is what makes that a
 *  guarantee rather than a hope. */
const DEFAULT_MAX_KEYS = 10_000;

const MS_PER_SECOND = 1000;

export type RateLimitDecision = {
	allowed: boolean;
	limit: number;
	/** Requests left in this window, never below zero. */
	remaining: number;
	/** Seconds until the window resets, rounded up — what `Retry-After`
	 *  and `RateLimit-Reset` carry. */
	resetSeconds: number;
};

export type RateLimiterOptions = {
	limit: number;
	/** Most distinct keys held. Oldest windows are evicted first. */
	maxKeys?: number;
	/** A clock, for tests. */
	now?: () => number;
	windowMs: number;
};

type Bucket = { count: number; windowStart: number };

export const createRateLimiter = ({
	limit,
	maxKeys = DEFAULT_MAX_KEYS,
	now = () => Date.now(),
	windowMs
}: RateLimiterOptions) => {
	const buckets = new Map<string, Bucket>();

	/* Least-recently-seen first. `Map` iterates in insertion order and
	 * `check` deletes-then-sets on every hit, so the front is the key
	 * untouched for longest.
	 *
	 * A first version swept expired buckets before touching live ones, on
	 * the reasoning that evicting a live bucket hands that client a fresh
	 * allowance. That sweep can never fire usefully and is gone: touching
	 * an expired bucket resets its window, so a bucket cannot be both
	 * expired and recently touched — insertion order already orders by
	 * liveness, and the front-most entries are the most expired. Removing
	 * it also drops a full scan of the map from every eviction. */
	const evict = () => {
		while (buckets.size >= maxKeys) {
			const oldest = buckets.keys().next();
			if (oldest.done === true) return;
			buckets.delete(oldest.value);
		}
	};

	const check = (key: string) => {
		const stamp = now();
		const existing = buckets.get(key);
		const live =
			existing !== undefined && stamp - existing.windowStart < windowMs;
		const bucket: Bucket = live
			? { count: existing.count + 1, windowStart: existing.windowStart }
			: { count: 1, windowStart: stamp };

		if (!live && !buckets.has(key)) evict();
		/* Delete before set so the key moves to the end of the insertion
		 * order: that is what makes the front of the map the least
		 * recently seen. */
		buckets.delete(key);
		buckets.set(key, bucket);

		const elapsed = stamp - bucket.windowStart;
		const decision: RateLimitDecision = {
			allowed: bucket.count <= limit,
			limit,
			remaining: Math.max(0, limit - bucket.count),
			resetSeconds: Math.max(
				1,
				Math.ceil((windowMs - elapsed) / MS_PER_SECOND)
			)
		};

		return decision;
	};

	return {
		check,
		/** Buckets held, for a test asserting the cap. */
		size: () => buckets.size
	};
};

/** The first value of `x-forwarded-for`: the client's own hop, as with
 *  `x-forwarded-proto`. Later values are the proxies in between. */
const forwardedClient = (request: Request) => {
	const header = request.headers.get('x-forwarded-for');
	if (header === null) return undefined;
	const first = (header.split(',')[0] ?? '').trim();

	return first === '' ? undefined : first;
};

/** What to count a request against.
 *
 *  `address` is the connection's own address, which only the server can
 *  know — pass `server.requestIP(request)?.address`. `trustProxy` opts into
 *  `x-forwarded-for`, which is correct behind a proxy that sets it and
 *  unsafe anywhere else: a client that can choose its own key has no
 *  limit. */
export const clientKeyFor = (
	request: Request,
	address: string | undefined,
	trustProxy = false
) => {
	const forwarded = trustProxy ? forwardedClient(request) : undefined;

	return forwarded ?? address ?? 'unknown';
};
