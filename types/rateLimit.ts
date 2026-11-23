export type RateLimitRule = {
	limit: number;
	/** Path prefix this rule covers. The longest matching prefix wins, so
	 *  `/api/upload` can be stricter than `/api`. */
	path: string;
	windowMs?: number;
};

export type RateLimitConfig = {
	/** Requests per window for any path not covered by a rule. Leave it
	 *  out to limit only the paths `rules` names. */
	limit?: number;
	/** Most distinct client keys held at once. Default 10000. The oldest
	 *  are evicted, which is what keeps the limiter from becoming the
	 *  memory-exhaustion vector it exists to prevent. */
	maxKeys?: number;
	rules?: RateLimitRule[];
	/** Count `x-forwarded-for`'s client hop instead of the connection
	 *  address.
	 *
	 *  Off by default, and the default matters: a client that chooses its
	 *  own key has no limit, so with this on in front of anything that is
	 *  not a proxy setting that header, a fresh value per request is a
	 *  fresh allowance per request. Turn it on only when a proxy you
	 *  control sets it. */
	trustProxy?: boolean;
	/** Window length in milliseconds. Default 60000. */
	windowMs?: number;
};
