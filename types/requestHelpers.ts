/** The request's headers, for reading. */
export type ReadonlyRequestHeaders = Pick<
	Headers,
	'entries' | 'forEach' | 'get' | 'getSetCookie' | 'has' | 'keys' | 'values'
> &
	Iterable<[string, string]>;

export type CookieSameSite = 'lax' | 'none' | 'strict';

export type CookieOptions = {
	domain?: string;
	/** When the cookie expires. `maxAge` wins if both are given. */
	expires?: Date;
	/** Hidden from the page's JavaScript. Default `true`: turn it off
	 *  only for a cookie a script has to read. */
	httpOnly?: boolean;
	/** Lifetime in seconds. Without this or `expires` the cookie lasts
	 *  for the browser session. */
	maxAge?: number;
	partitioned?: boolean;
	/** Default `/`. */
	path?: string;
	/** Default `lax`. `none` requires `secure`. */
	sameSite?: CookieSameSite;
	/** Default: whether the request arrived over HTTPS. */
	secure?: boolean;
};

export type RequestCookies = {
	/** Remove a cookie. `path` and `domain` must match the ones it was
	 *  set with, as a browser requires. */
	delete: (
		name: string,
		options?: Pick<CookieOptions, 'domain' | 'path'>
	) => void;
	/** The cookie's value: one set during this request if there is one,
	 *  otherwise the one the browser sent. */
	get: (name: string) => string | undefined;
	/** Every cookie, as `get` would report each. */
	getAll: () => Record<string, string>;
	has: (name: string) => boolean;
	/** Send a cookie with the response. */
	set: (name: string, value: string, options?: CookieOptions) => void;
};
