/* What the running server compresses (`compression` in the config). */

export type CompressionConfig = {
	/** Compress pages as they are served: brotli, or gzip for a client
	 *  that does not accept brotli. On by default, for a page rendered
	 *  in one piece. `false` sends every page as it was rendered, for a
	 *  server behind something that compresses for it. */
	pages?: boolean;
	/** Also compress a page rendered as a stream — every React, Svelte
	 *  and Vue page — as it streams, flushed after each chunk so its
	 *  first byte is not held back. Off by default.
	 *
	 *  Off, because it changes what a page handler returns: the body
	 *  of its response is then compressed bytes. A route that reads
	 *  that body or wraps it in a response of its own (`await
	 *  response.text()`) would read those bytes as HTML. Turn this on
	 *  when no route does, or have each one take the page back first
	 *  with `uncompressedPage(response)`. */
	streaming?: boolean;
};
