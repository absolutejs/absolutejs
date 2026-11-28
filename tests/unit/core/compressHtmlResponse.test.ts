import { describe, expect, test } from 'bun:test';
import { brotliDecompressSync, gunzipSync, gzipSync } from 'node:zlib';
import {
	chosenHtmlEncoding,
	compressHtml,
	taggedWithEncoding
} from '../../../src/core/compressHtmlResponse';
import {
	STREAMING_PAGE_HEADER,
	withPageCacheHeaders
} from '../../../src/core/pageResponseCache';
import { HTML_CONTENT_TYPE } from '../../../src/constants';

/* Build-time precompression writes `.br` and `.gz` beside every
 * compressible file, which covers static assets and cannot cover a page
 * handler's response: that HTML is produced per request, and even a
 * static HTML page served through `handleHTMLPageRequest` is read and
 * returned by the handler rather than by the asset plugin, so the `.br`
 * on disk was never reached.
 *
 * Measured against the example app in production, asking for `br, gzip`:
 * every page came back with no `content-encoding`, and compressing those
 * exact bodies saved 64-77%. */

const page = (body: string, headers?: HeadersInit) =>
	new Response(body, {
		headers: { 'Content-Type': HTML_CONTENT_TYPE, ...headers }
	});

const asking = (acceptEncoding: string | null) =>
	new Request(
		'http://localhost/page',
		acceptEncoding === null
			? undefined
			: { headers: { 'accept-encoding': acceptEncoding } }
	);

/* Repetitive enough to compress well, and over the 1 KB floor. */
const BIG_PAGE = `<!DOCTYPE html><html><body>${'<p>hello world</p>'.repeat(200)}</body></html>`;

describe('chosenHtmlEncoding', () => {
	test('prefers brotli when both are offered', () => {
		expect(
			chosenHtmlEncoding({ body: BIG_PAGE, request: asking('gzip, br') })
		).toBe('br');
	});

	test('falls back to gzip when brotli is not offered', () => {
		expect(
			chosenHtmlEncoding({ body: BIG_PAGE, request: asking('gzip') })
		).toBe('gzip');
	});

	/* `q=0` means "not this one", which is not the same as offering it. */
	test('respects q=0', () => {
		expect(
			chosenHtmlEncoding({
				body: BIG_PAGE,
				request: asking('br;q=0, gzip')
			})
		).toBe('gzip');
	});

	test('declines when the client asks for nothing', () => {
		expect(
			chosenHtmlEncoding({ body: BIG_PAGE, request: asking(null) })
		).toBeUndefined();
	});

	/* Below the floor the `content-encoding` and `vary` headers cost more
	 * than the body saves. */
	test('declines a body under the size floor', () => {
		expect(
			chosenHtmlEncoding({ body: '<p>tiny</p>', request: asking('br') })
		).toBeUndefined();
	});

	/* A page with no request has no `accept-encoding` to read. This is
	 * exactly what made static HTML and HTMX pages come back
	 * uncompressed: their handler called the wrapper without one. */
	test('declines when there is no request at all', () => {
		expect(chosenHtmlEncoding({ body: BIG_PAGE })).toBeUndefined();
	});
});

describe('compressHtml', () => {
	test('round-trips through brotli', async () => {
		const result = await compressHtml({ body: BIG_PAGE, encoding: 'br' });

		expect(result).not.toBeNull();
		expect(result?.bytes.byteLength).toBeLessThan(BIG_PAGE.length);
		expect(
			brotliDecompressSync(result?.bytes ?? Buffer.alloc(0)).toString()
		).toBe(BIG_PAGE);
	});

	test('round-trips through gzip', async () => {
		const result = await compressHtml({ body: BIG_PAGE, encoding: 'gzip' });

		expect(gunzipSync(result?.bytes ?? Buffer.alloc(0)).toString()).toBe(
			BIG_PAGE
		);
	});

	/* Already-compressed input, which is what genuinely incompressible
	 * looks like — random printable ASCII is not: a 94-character alphabet
	 * carries about six bits per byte, so gzip still takes ~17% off it
	 * and my first attempt at this test asserted the wrong thing.
	 * Compressing again would cost CPU on both ends to make the payload
	 * bigger, so it is declined. */
	test('declines when compressing does not save enough', async () => {
		const alreadyCompressed = gzipSync(
			Buffer.from(BIG_PAGE, 'utf-8')
		).toString('latin1');
		const result = await compressHtml({
			body: alreadyCompressed,
			encoding: 'gzip'
		});

		expect(result).toBeNull();
	});
});

describe('taggedWithEncoding', () => {
	/* The quoting and the weak-validator prefix both have to survive, or
	 * the header is malformed. */
	test('keeps the W/ prefix and the quotes', () => {
		expect(taggedWithEncoding('W/"abc123"', 'br')).toBe('W/"abc123-br"');
	});

	test('handles an unquoted tag without mangling it', () => {
		expect(taggedWithEncoding('abc123', 'gzip')).toBe('abc123-gzip');
	});
});

describe('withPageCacheHeaders', () => {
	test('compresses an HTML page the client can decode', async () => {
		const response = await withPageCacheHeaders(
			page(BIG_PAGE),
			asking('br')
		);

		expect(response.headers.get('content-encoding')).toBe('br');
		const bytes = Buffer.from(await response.arrayBuffer());
		expect(brotliDecompressSync(bytes).toString()).toBe(BIG_PAGE);
	});

	/* Without this a shared cache can hand brotli bytes to a client that
	 * only accepts gzip. */
	test('varies on accept-encoding', async () => {
		const response = await withPageCacheHeaders(
			page(BIG_PAGE),
			asking('br')
		);

		expect(response.headers.get('vary')).toContain('accept-encoding');
	});

	/* An encoded body is a different representation of the entity, so it
	 * needs its own validator — otherwise the 304 path can match a client
	 * holding the identity version and answer it with brotli bytes. */
	test('gives the encoded representation its own ETag', async () => {
		const plain = await withPageCacheHeaders(page(BIG_PAGE), asking(null));
		const encoded = await withPageCacheHeaders(
			page(BIG_PAGE),
			asking('br')
		);

		expect(plain.headers.get('etag')).not.toBe(encoded.headers.get('etag'));
		expect(encoded.headers.get('etag')).toContain('-br');
	});

	test('answers 304 when the client already has the encoded version', async () => {
		const first = await withPageCacheHeaders(page(BIG_PAGE), asking('br'));
		const etag = first.headers.get('etag') ?? '';
		const repeat = await withPageCacheHeaders(
			page(BIG_PAGE),
			new Request('http://localhost/page', {
				headers: { 'accept-encoding': 'br', 'if-none-match': etag }
			})
		);

		expect(repeat.status).toBe(304);
	});

	/* The identity ETag must not match an encoded request, or a cache
	 * serves the wrong bytes. */
	test('does not 304 an encoded request against the identity ETag', async () => {
		const plain = await withPageCacheHeaders(page(BIG_PAGE), asking(null));
		const repeat = await withPageCacheHeaders(
			page(BIG_PAGE),
			new Request('http://localhost/page', {
				headers: {
					'accept-encoding': 'br',
					'if-none-match': plain.headers.get('etag') ?? ''
				}
			})
		);

		expect(repeat.status).toBe(200);
		expect(repeat.headers.get('content-encoding')).toBe('br');
	});

	/* Compressing a stream through THIS path would buffer it, forfeiting
	 * the fast first byte that is the whole point of streaming. It was
	 * once skipped for that reason, and is now compressed as it streams
	 * instead (compressPageStream.ts): encoded, and with no ETag, since
	 * its headers leave before its body exists to be hashed. */
	test('compresses a streaming page as it streams, without an ETag', async () => {
		const response = await withPageCacheHeaders(
			page(BIG_PAGE, { [STREAMING_PAGE_HEADER]: '1' }),
			asking('br')
		);

		expect(response.headers.get('content-encoding')).toBe('br');
		expect(response.headers.get('cache-control')).toBe('no-cache');
		expect(response.headers.get('etag')).toBeNull();
	});

	test('leaves a body that is already encoded alone', async () => {
		const response = await withPageCacheHeaders(
			page(BIG_PAGE, { 'content-encoding': 'gzip' }),
			asking('br')
		);

		expect(response.headers.get('content-encoding')).toBe('gzip');
	});

	test('passes a non-HTML response straight through', async () => {
		const json = new Response('{"a":1}', {
			headers: { 'Content-Type': 'application/json' }
		});
		const response = await withPageCacheHeaders(json, asking('br'));

		expect(response.headers.get('content-encoding')).toBeNull();
		expect(response.headers.get('etag')).toBeNull();
	});

	/* A page under the floor still gets its identity ETag, and must not
	 * be tagged as encoded. */
	test('a page too small to compress keeps its identity ETag', async () => {
		const response = await withPageCacheHeaders(
			page('<p>tiny</p>'),
			asking('br')
		);

		expect(response.headers.get('content-encoding')).toBeNull();
		expect(response.headers.get('etag')).not.toContain('-br');
	});
});
