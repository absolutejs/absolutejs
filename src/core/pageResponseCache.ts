import { withRouteHead } from './routeHead';
import { createHash } from 'node:crypto';
import { modulePreloadLinkHeader } from '../build/modulePreload';
import { modulePreloadsFor } from './modulePreloadRegistry';
import { getPageEntry } from './requestContext';
import {
	chosenHtmlEncoding,
	compressHtml,
	taggedWithEncoding
} from './compressHtmlResponse';
import { HTML_CONTENT_TYPE } from '../constants';
import { ACTION_FLASH_COOKIE } from '../utils/formActionState';
import { markdownAlternateLink } from '../utils/pageMarkdownRef';
import { withRenderSpan } from './renderTracing';

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

const HTML_MEDIA_TYPE = 'text/html';

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
	if (!contentType.includes(HTML_MEDIA_TYPE)) return response;

	/* Every framework's HTML response funnels through here, so one span
	 * covers the ETag hash and the compression for all of them — the work
	 * after the render that a render-only trace would attribute to
	 * nothing. */
	/* Set before the cache path so it reaches BOTH kinds of response. A
	 * streamed page is the one that needs it most — its bytes start
	 * flowing immediately, so its headers are the earliest chance the
	 * browser gets to learn what the entry will import. */
	addModulePreloadLinks(response);
	// Where this page's Markdown is, when pages are served that way
	// (pageMarkdown.ts).
	const alternate = response.ok ? markdownAlternateLink(request) : undefined;
	if (alternate) response.headers.append('link', alternate);
	// A file route's metadata, into the head (routeHead.ts). Here, ahead
	// of the hash and the compression, so both are of the page as sent.
	const page = withRouteHead(response);

	return withRenderSpan('render.response', { phase: 'response' }, () =>
		cachedPageResponse(page, request, options)
	);
};

/* `Link: </chunk.js>; rel=modulepreload` rather than markup.
 *
 * A browser discovers a module graph by walking it, so the nine modules a
 * page's entry imports (measured on the example app) are not requested
 * until the entry has been fetched and parsed — two round trips after the
 * HTML. The header starts them with the response itself, and reaches a
 * streamed page, whose markup does not exist yet when its headers are
 * sent.
 *
 * It is also the shape a 103 Early Hints response would carry, so if
 * `Bun.serve` ever grows one this moves rather than being rewritten.
 * Today it cannot: a `Response` must have a status of 101 or 200-599, so
 * an informational response is not expressible — only `node:http` can
 * send one, and that is not the server underneath here. */
const addModulePreloadLinks = (response: Response) => {
	if (response.headers.has('link')) return;
	const preloads = modulePreloadsFor(getPageEntry());
	if (preloads.length === 0) return;
	response.headers.set('link', modulePreloadLinkHeader(preloads));
};

/* A request carrying a form result is about to be answered with that
 * result written into the page (`consumeActionFlash`): one visitor's
 * errors and typed values, in a body nobody else gets. Neither shortcut
 * below is right for it.
 *
 *   `304` tells the browser to show the copy it has, which has no result
 *   in it — so after a submission without JavaScript the form came back
 *   empty, with no error, and the result was never consumed.
 *
 *   Compressing here hands the flash step bytes it cannot rewrite, and
 *   it skips them — the same blank form, on any page large enough to be
 *   compressed.
 *
 * Only the cookie's presence is read. Whether it is valid is the flash
 * step's business; a stale or forged one costs a visitor one uncached,
 * uncompressed page. */
const awaitsActionFlash = (request: Request | undefined) =>
	request?.headers.get('cookie')?.includes(`${ACTION_FLASH_COOKIE}=`) ===
	true;

const cachedPageResponse = async (
	response: Response,
	request: Request | undefined,
	options: PageCacheOptions | undefined
) => {
	const isStreaming = response.headers.get(STREAMING_PAGE_HEADER) === '1';

	// Streaming (or bodyless) responses: no-cache only, strip the marker —
	// unless the caller opted this page into the buffered-ETag path, in which
	// case we fall through and buffer the stream below to hash it.
	if ((isStreaming && !options?.bufferStreamForEtag) || !response.body) {
		response.headers.delete(STREAMING_PAGE_HEADER);
		response.headers.set('cache-control', 'no-cache');

		return response;
	}

	// Buffer the body (for a streamed page this consumes the stream, forfeiting
	// the fast first byte) so we can hash it into a content-hash ETag.
	const html = await response.text();
	const headers = new Headers(response.headers);
	headers.delete(STREAMING_PAGE_HEADER);
	headers.set('cache-control', 'no-cache');

	/* The encoding is settled BEFORE the ETag, because an encoded body is
	 * a different representation and needs its own validator — otherwise
	 * the 304 below can match a client holding the identity version and
	 * hand it brotli bytes. Settling it first also means a 304 skips the
	 * compression work entirely. A handler that already encoded its own
	 * body is left alone. */
	const personalised = awaitsActionFlash(request);
	const encoding =
		headers.has('content-encoding') || personalised
			? undefined
			: chosenHtmlEncoding({ body: html, request });
	const etag =
		encoding === undefined
			? computeEtag(html)
			: taggedWithEncoding(computeEtag(html), encoding);
	headers.set('etag', etag);

	if (!personalised && request?.headers.get('if-none-match') === etag) {
		return new Response(null, {
			headers: { 'cache-control': 'no-cache', etag },
			status: 304
		});
	}

	/* The body is already a string here for the ETag, so compressing it
	 * costs one compress call rather than another buffering pass. Build-
	 * time precompression cannot reach these: the HTML is produced per
	 * request, and even a static page served through a page handler is
	 * read and returned by the handler rather than by the asset plugin,
	 * so the `.br` beside it on disk was never used. Measured on the
	 * example app: 64-77% off every page. */
	const compressed =
		encoding === undefined
			? null
			: await compressHtml({ body: html, encoding });
	if (!compressed) {
		/* Compression declined after all — too small to be worth it, or
		 * it did not save enough. The ETag must then be the identity one,
		 * or a cache stores this body under an encoded validator. */
		headers.set('etag', computeEtag(html));

		return new Response(html, {
			headers,
			status: response.status,
			statusText: response.statusText
		});
	}

	headers.set('content-encoding', compressed.encoding);
	/* Without this a shared cache can hand brotli bytes to a client that
	 * only accepts gzip. */
	headers.append('vary', 'accept-encoding');
	headers.delete('content-length');

	return new Response(compressed.bytes, {
		headers,
		status: response.status,
		statusText: response.statusText
	});
};
