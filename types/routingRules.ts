/** The statuses a redirect may answer with. 308 and 307 keep the request
 *  method; 301, 302 and 303 let the browser change a POST into a GET. */
export type RedirectStatus = 301 | 302 | 303 | 307 | 308;

/** Send a request for one URL to another.
 *
 *  `from` is a path pattern: literal segments, `:name` for one segment,
 *  and a final `*` for whatever follows. `to` may use the same names, and
 *  may be a full `https://` URL. */
export type RedirectRule = {
	from: string;
	/** Default 308: permanent, and the method is kept. */
	status?: RedirectStatus;
	to: string;
};

/** Serve one URL with the route registered at another. The address the
 *  visitor sees does not change. `to` must be a path of this app. */
export type RewriteRule = {
	from: string;
	to: string;
};

/** Add response headers to every path a pattern matches. A header the
 *  route sets itself is left as the route set it. */
export type HeaderRule = {
	headers: Record<string, string>;
	path: string;
};

export type RoutingRulesConfig = {
	headers?: readonly HeaderRule[];
	redirects?: readonly RedirectRule[];
	rewrites?: readonly RewriteRule[];
};
