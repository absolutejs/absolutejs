/* What the running server compresses (`compression` in the config). */

export type CompressionConfig = {
	/** Compress pages as they are served: brotli, or gzip for a client
	 *  that does not accept brotli. On by default. A streamed page is
	 *  compressed as it streams and flushed after each chunk, so its
	 *  first byte is not held back. `false` sends every page as it was
	 *  rendered, for a server behind something that compresses for
	 *  it. */
	pages?: boolean;
};
