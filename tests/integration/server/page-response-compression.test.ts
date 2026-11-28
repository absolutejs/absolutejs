import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { startProdServer, type ProdServer } from '../../helpers/prodServer';

/* Build-time precompression writes `.br` and `.gz` beside every
 * compressible file, which covers static assets and cannot cover a page
 * handler's response: that HTML is produced per request, and even a
 * static HTML page served through `handleHTMLPageRequest` is read and
 * returned by the handler rather than by the asset plugin, so the `.br`
 * on disk was never reached.
 *
 * Measured against this app in production before the fix: every page
 * came back with no `content-encoding`, and compressing those exact
 * bodies saved 64-77%.
 *
 * The unit tests cover `withPageCacheHeaders` directly. What needs a real
 * server is the WIRING, because that is where the bug was: the static
 * page handlers called the wrapper without a request, so there was no
 * `accept-encoding` to read and nothing compressed however correct the
 * compressor was. */

let server: ProdServer;

const fetchPage = async (path: string, acceptEncoding: string) => {
	const response = await fetch(`${server.baseUrl}${path}`, {
		headers: { accept: 'text/html', 'accept-encoding': acceptEncoding }
	});
	/* `fetch` decodes transparently, so the header is what tells us
	 * whether the wire bytes were encoded. */
	await response.arrayBuffer();

	return response;
};

beforeAll(async () => {
	server = await startProdServer();
}, 300_000);

afterAll(async () => {
	await server.kill();
});

describe('page response compression', () => {
	test('a static HTML page is served compressed', async () => {
		const response = await fetchPage('/', 'br, gzip');

		expect(response.status).toBe(200);
		expect(response.headers.get('content-encoding')).toBe('br');
		expect(response.headers.get('vary')).toContain('accept-encoding');
	}, 120_000);

	test('a static HTMX page is served compressed', async () => {
		const response = await fetchPage('/htmx', 'br, gzip');

		expect(response.headers.get('content-encoding')).toBe('br');
	}, 120_000);

	test('a server-rendered Angular page is served compressed', async () => {
		const response = await fetchPage('/angular', 'br, gzip');

		expect(response.headers.get('content-encoding')).toBe('br');
	}, 120_000);

	test('gzip is used when brotli is not offered', async () => {
		const response = await fetchPage('/', 'gzip');

		expect(response.headers.get('content-encoding')).toBe('gzip');
	}, 120_000);

	test('a client that accepts nothing gets the page uncompressed', async () => {
		const response = await fetchPage('/', 'identity');

		expect(response.headers.get('content-encoding')).toBeNull();
		expect(response.status).toBe(200);
	}, 120_000);

	/* Compressing through the buffered path would forfeit the fast first
	 * byte that is the whole point of streaming, so these pages were
	 * once left uncompressed. They are now compressed as they stream
	 * (compressPageStream.ts); streamed-page-compression.test.ts checks
	 * that the first byte still leaves early. */
	test('a streaming page is compressed as it streams', async () => {
		const response = await fetchPage('/react', 'br, gzip');

		expect(response.status).toBe(200);
		expect(response.headers.get('content-encoding')).toBe('br');
	}, 120_000);

	/* The encoded body is a different representation, so it carries its
	 * own validator and a repeat visit still revalidates. */
	test('a repeat visit revalidates against the encoded ETag', async () => {
		const first = await fetchPage('/', 'br, gzip');
		const etag = first.headers.get('etag');

		expect(etag).toContain('-br');
		const repeat = await fetch(`${server.baseUrl}/`, {
			headers: {
				accept: 'text/html',
				'accept-encoding': 'br, gzip',
				'if-none-match': etag ?? ''
			}
		});

		expect(repeat.status).toBe(304);
	}, 120_000);
});
