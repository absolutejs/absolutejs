import { statSync } from 'node:fs';
import { logWarn } from '../utils/logger';

/* A pre-rendered page served so that a cache may keep it.
 *
 * A pre-rendered page is the same bytes for every visitor until it is
 * rendered again, which is exactly what a shared cache is for — and it
 * was served with a content type and nothing else: no `ETag`, so no
 * `304`, and no policy, so nothing a CDN could act on. Every request
 * for it was answered with the whole page.
 *
 * Served through here it carries:
 *
 * - a strong `ETag`, the hash of the bytes sent;
 * - a `304` with no body for a copy that is still current;
 * - `Cache-Control: public, no-cache` — keep it, and ask before using
 *   it — or, given a lifetime, `s-maxage` for shared caches;
 * - `Vary: Accept`, because the same address also answers a request for
 *   the page's data (`application/vnd.absolute.route+json`).
 *
 * Used for a whole pre-rendered page when `static.cache` asks for it,
 * and for a partial page's shell in edge mode (partialPrerenderEdge.ts).
 * Never under per-request CSP nonces: such a page is rewritten for each
 * request, and a stored copy could not carry the next one's nonce. */

/** `true`, or a lifetime in seconds for shared caches. */
export type SharedCachePolicy = boolean | { maxAge?: number } | undefined;

type Validated = { body: string; etag: string; stamp: string };

type ServeValidatedInput = {
	filePath: string;
	/** What the response says it is, in `x-absolute-partial-prerender`
	 *  — and what keeps two readings of one file apart here. */
	kind: string;
	policy: SharedCachePolicy;
	request: Request;
	/** Applied to the file's text before it is hashed and sent. */
	transform?: (html: string) => string;
};

const NOT_MODIFIED = 304;
const HASH_RADIX = 36;

/* One per file and kind, until the file changes: a revalidation
 * replaces the file, and the next request reads the new one. */
const known = new Map<string, Validated>();

const stampOf = (filePath: string) => {
	const { mtimeMs, size } = statSync(filePath);

	return `${mtimeMs}:${size}`;
};

const read = async ({ filePath, kind, transform }: ServeValidatedInput) => {
	const key = `${kind}:${filePath}`;
	const stamp = stampOf(filePath);
	const current = known.get(key);
	if (current?.stamp === stamp) return current;
	const html = await Bun.file(filePath).text();
	const body = transform ? transform(html) : html;
	const validated: Validated = {
		body,
		etag: `"${Bun.hash(body).toString(HASH_RADIX)}"`,
		stamp
	};
	known.set(key, validated);

	return validated;
};

/* A cache between here and the browser may have compressed the page
 * and, rightly, weakened the tag it sends back. The content is the
 * same content. */
const matches = (request: Request, etag: string) =>
	(request.headers.get('if-none-match') ?? '')
		.split(',')
		.map((value) => value.trim().replace(/^W\//, ''))
		.some((value) => value === '*' || value === etag);

const cacheControlFor = (policy: SharedCachePolicy) => {
	const maxAge = typeof policy === 'object' ? policy.maxAge : undefined;

	/* `no-cache` is "keep it, and ask before using it". With a lifetime,
	 * the browser still asks every time; it is the shared cache that is
	 * trusted for that long. */
	return typeof maxAge === 'number' && maxAge > 0
		? `public, max-age=0, s-maxage=${Math.floor(maxAge)}, must-revalidate`
		: 'public, no-cache';
};

/** Whether a policy asks for anything. */
export const asksForSharedCaching = (policy: SharedCachePolicy) =>
	policy === true || (typeof policy === 'object' && policy !== null);

/** The file at `filePath` as a response a shared cache may keep, or a
 *  `304` when the copy the request names is the current one. */
export const serveValidated = async (input: ServeValidatedInput) => {
	const { body, etag } = await read(input);
	const headers = new Headers({
		'cache-control': cacheControlFor(input.policy),
		etag,
		vary: 'Accept',
		'x-absolute-partial-prerender': input.kind
	});
	if (matches(input.request, etag))
		return new Response(null, { headers, status: NOT_MODIFIED });
	headers.set('content-type', 'text/html; charset=utf-8');

	return new Response(body, { headers });
};

type Warned = { nonces: boolean };

const warned: Warned = { nonces: false };

/** Says, once, that `static.cache` is set and cannot be honoured: the
 *  app sends a per-request CSP nonce, so each pre-rendered page is
 *  rewritten for the request it answers. A fact about the deployment,
 *  not about a request. */
export const warnCacheUnderNonces = (policy: SharedCachePolicy) => {
	if (warned.nonces || !asksForSharedCaching(policy)) return;
	warned.nonces = true;
	logWarn(
		'static.cache is set, but this app sends a per-request CSP nonce (secureHeaders()), which a stored page cannot carry. Pre-rendered pages are served without cache headers, as without it.'
	);
};
