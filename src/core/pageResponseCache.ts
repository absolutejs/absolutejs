import { createHash } from 'node:crypto';

// The SPA cache policy, applied to every framework's HTML page response.
//
// Hashed JS/CSS assets are served `immutable` (cached forever) elsewhere — that
// is the real cache benefit and is untouched. The HTML *shell*, however, must
// always be revalidated: if a browser caches it, it keeps pointing at the
// PREVIOUS deploy's asset hashes, so new deploys never reach users ("hard
// refresh shows nothing new"). We don't throw the cache away though — `no-cache`
// + a content-hash `ETag` lets the browser keep its copy and revalidate: a tiny
// `304 Not Modified` when unchanged, a fresh `200` only on a new deploy.
//
// Streaming page responses can't carry a content-hash ETag (headers are flushed
// before the body renders), so their builders tag themselves with the header
// below and we mark them `no-cache` without an ETag.
// Internal, request-scoped marker (stripped before the response is sent) telling
// withPageCacheHeaders that a response streams and so can't carry a content-hash
// ETag. Exported so other internal response builders (e.g. the streaming-slot
// enhancer) can tag their streamed output too.
export const STREAMING_PAGE_HEADER = 'x-absolute-stream';

const HTML_CONTENT_TYPE = 'text/html';

/** Headers for a STREAMING html page response — `text/html` plus the streaming
 *  marker so {@link withPageCacheHeaders} marks it `no-cache` (no ETag). */
export const streamingPageHeaders = (extra?: HeadersInit) => {
	const headers = new Headers(extra);
	headers.set('content-type', HTML_CONTENT_TYPE);
	headers.set(STREAMING_PAGE_HEADER, '1');

	return headers;
};

const computeEtag = (html: string) =>
	`W/"${createHash('sha1').update(html).digest('base64url')}"`;

/** Options for {@link withPageCacheHeaders}. */
export type PageCacheOptions = {
	/** Opt a *streaming* page into the buffered-ETag path: buffer its whole
	 *  body before sending so it can carry a content-hash `ETag` and serve a
	 *  `304` on repeat visits. This trades streaming's fast first byte for the
	 *  revalidation saving, so only set it on pages whose output is static
	 *  enough that the 304 is worth losing the stream (e.g. a marketing page).
	 *  No effect on already-buffered pages — those are ETagged regardless. */
	bufferStreamForEtag?: boolean;
};

/** Apply the SPA cache policy to a page Response. HTML gets `no-cache` (+ a
 *  content-hash `ETag` / `304` for buffered responses); non-HTML responses
 *  (redirects, JSON, etc.) pass through untouched. Safe to call on every page
 *  handler's final response.
 *
 *  Streaming pages skip the ETag (their headers flush before the body renders)
 *  unless the caller passes `bufferStreamForEtag`, which buffers the stream so
 *  it can be hashed — see {@link PageCacheOptions}. */
export const withPageCacheHeaders = async (
	response: Response,
	request?: Request,
	options?: PageCacheOptions
) => {
	const contentType = response.headers.get('content-type') ?? '';
	if (!contentType.includes(HTML_CONTENT_TYPE)) return response;

	const isStreaming = response.headers.get(STREAMING_PAGE_HEADER) === '1';

	// Streaming (or bodyless) responses: no-cache only, strip the marker —
	// unless the caller opted this page into the buffered-ETag path, in which
	// case we fall through and buffer the stream below to hash it.
	if (
		(isStreaming && !options?.bufferStreamForEtag) ||
		!response.body
	) {
		response.headers.delete(STREAMING_PAGE_HEADER);
		response.headers.set('cache-control', 'no-cache');

		return response;
	}

	// Buffer the body (for a streamed page this consumes the stream, forfeiting
	// the fast first byte) so we can hash it into a content-hash ETag.
	const html = await response.text();
	const etag = computeEtag(html);
	if (request?.headers.get('if-none-match') === etag) {
		return new Response(null, {
			headers: { 'cache-control': 'no-cache', etag },
			status: 304
		});
	}

	const headers = new Headers(response.headers);
	headers.delete(STREAMING_PAGE_HEADER);
	headers.set('cache-control', 'no-cache');
	headers.set('etag', etag);

	return new Response(html, {
		headers,
		status: response.status,
		statusText: response.statusText
	});
};
