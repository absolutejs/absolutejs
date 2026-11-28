import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import {
	compressedPage,
	compressStream,
	uncompressedPage
} from '../../../src/core/compressPageStream';
import {
	streamingPageHeaders,
	withPageCacheHeaders
} from '../../../src/core/pageResponseCache';
import { PARTIAL_SHELL_HEADER } from '../../../src/core/partialPrerender';
import { enhanceHtmlResponseWithStreamingSlots } from '../../../src/core/responseEnhancers';
import { setCompression } from '../../../src/utils/compressionRef';
import { ACTION_FLASH_COOKIE } from '../../../src/utils/formActionState';

/* A streamed page, compressed as it streams. */

afterEach(() => setCompression(undefined));

const encoder = new TextEncoder();

/* A body written in pieces, the later ones when the test says. */
const pieces = (first: string) => {
	let push: (text: string | null) => void = () => undefined;
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(encoder.encode(first));
			push = (text) => {
				if (text === null) controller.close();
				else controller.enqueue(encoder.encode(text));
			};
		}
	});

	return { body, push: (text: string | null) => push(text) };
};

const bytesOf = async (stream: ReadableStream<Uint8Array>) =>
	Buffer.from(await new Response(stream).arrayBuffer());

const page = (html = '<html><body><h1>Page</h1></body></html>') =>
	new Response(html, { headers: streamingPageHeaders() });

const asking = (headers: Record<string, string> = {}) =>
	new Request('http://localhost/page', {
		headers: { 'accept-encoding': 'br, gzip', ...headers }
	});

describe('compressStream', () => {
	test('round-trips through brotli and through gzip', async () => {
		const html = `<html>${'<p>The quick brown fox.</p>'.repeat(200)}</html>`;
		const brotli = await bytesOf(
			compressStream(
				new Response(html).body ?? new ReadableStream(),
				'br'
			)
		);
		const gzip = await bytesOf(
			compressStream(
				new Response(html).body ?? new ReadableStream(),
				'gzip'
			)
		);

		expect(brotliDecompressSync(brotli).toString()).toBe(html);
		expect(gunzipSync(gzip).toString()).toBe(html);
		expect(brotli.byteLength).toBeLessThan(html.length / 5);
	});

	/* Flushed after each chunk: the first is out before the second is
	 * written, which is the whole reason to stream. */
	test('sends each chunk on before the next is written', async () => {
		const { body, push } = pieces('<html><h1>shell</h1>');
		const reader = compressStream(body, 'br').getReader();
		const first = await reader.read();

		expect(first.done).toBe(false);
		expect(first.value?.byteLength).toBeGreaterThan(0);

		push('<p>late</p></html>');
		push(null);
		const rest: Uint8Array[] = [];
		for (;;) {
			const next = await reader.read();
			if (next.done) break;
			rest.push(next.value);
		}

		expect(
			brotliDecompressSync(
				Buffer.concat([first.value ?? new Uint8Array(), ...rest])
			).toString()
		).toBe('<html><h1>shell</h1><p>late</p></html>');
	});

	test('reads nothing from the page until it is read itself', async () => {
		let pulled = 0;
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				pulled += 1;
				controller.close();
			}
		});
		const compressed = compressStream(body, 'gzip');
		await Bun.sleep(5);

		expect(body.locked).toBe(false);
		await bytesOf(compressed);
		expect(pulled).toBeGreaterThan(0);
	});
});

/* Off unless asked for: it changes what a page handler returns, and a
 * route that reads that response would read compressed bytes as HTML. */
describe('a streamed page through the funnel, by default', () => {
	test('is sent as it was rendered, whatever the client accepts', async () => {
		const response = await withPageCacheHeaders(page(), asking());

		expect(response.headers.get('content-encoding')).toBeNull();
		expect(await response.text()).toContain('<h1>Page</h1>');
	});

	/* What broke: a route that wraps a page handler's response. */
	test('can be read and wrapped by a route, headers and all', async () => {
		const handled = await withPageCacheHeaders(page(), asking());
		const wrapped = new Response(await handled.text(), {
			headers: handled.headers
		});

		expect(wrapped.headers.get('content-encoding')).toBeNull();
		expect(await wrapped.text()).toContain('<h1>Page</h1>');
	});

	test('stays so with pages on and streaming not asked for', async () => {
		setCompression({ pages: true });
		const response = await withPageCacheHeaders(page(), asking());

		expect(response.headers.get('content-encoding')).toBeNull();
	});
});

describe('a streamed page through the funnel, with compression.streaming', () => {
	beforeEach(() => setCompression({ streaming: true }));

	test('is compressed for a client that accepts it', async () => {
		const response = await withPageCacheHeaders(page(), asking());

		expect(response.headers.get('content-encoding')).toBe('br');
		expect(response.headers.get('vary')).toContain('accept-encoding');
		expect(
			brotliDecompressSync(
				Buffer.from(await response.arrayBuffer())
			).toString()
		).toContain('<h1>Page</h1>');
	});

	test('is sent as it is when nothing says what the client accepts', async () => {
		const noRequest = await withPageCacheHeaders(page());
		const identity = await withPageCacheHeaders(
			page(),
			asking({ 'accept-encoding': 'identity' })
		);

		expect(noRequest.headers.get('content-encoding')).toBeNull();
		expect(identity.headers.get('content-encoding')).toBeNull();
	});

	/* The form result is written into the page after this. */
	test('is sent as it is to a request carrying a form result', async () => {
		const response = await withPageCacheHeaders(
			page(),
			asking({ cookie: `${ACTION_FLASH_COOKIE}=abc` })
		);

		expect(response.headers.get('content-encoding')).toBeNull();
	});

	test('is sent as it is to the pre-renderer asking for a shell', async () => {
		const response = await withPageCacheHeaders(
			page(),
			asking({ [PARTIAL_SHELL_HEADER]: '1' })
		);

		expect(response.headers.get('content-encoding')).toBeNull();
	});

	test('is sent as it is when the config turns page compression off', async () => {
		setCompression({ pages: false, streaming: true });
		const streamed = await withPageCacheHeaders(page(), asking());
		const buffered = await withPageCacheHeaders(
			new Response(`<html>${'<p>padding</p>'.repeat(200)}</html>`, {
				headers: { 'content-type': 'text/html; charset=utf-8' }
			}),
			asking()
		);

		expect(streamed.headers.get('content-encoding')).toBeNull();
		expect(buffered.headers.get('content-encoding')).toBeNull();
	});

	test('is left alone when its handler encoded it', async () => {
		const headers = streamingPageHeaders({ 'content-encoding': 'gzip' });
		const response = await withPageCacheHeaders(
			new Response('already', { headers }),
			asking()
		);

		expect(response.headers.get('content-encoding')).toBe('gzip');
		expect(await response.text()).toBe('already');
	});
});

/* A handler's response is not always finished when it is returned: a
 * wrapper may append streamed slots to its body. */
describe('a page taken back before it is sent', () => {
	test('is the page as it was', async () => {
		const original = page();
		const compressed = compressedPage(original, 'br');

		expect(compressed).not.toBe(original);
		expect(uncompressedPage(compressed)).toBe(original);
		expect(await original.text()).toContain('<h1>Page</h1>');
	});

	test('any other response is returned as it is', () => {
		const other = new Response('x');

		expect(uncompressedPage(other)).toBe(other);
	});

	test('so a slot appended by a wrapper lands in HTML, not in compressed bytes', async () => {
		setCompression({ streaming: true });
		const compressed = await withPageCacheHeaders(
			page(
				'<html><body><div id="slot" data-absolute-slot="true">loading</div></body></html>'
			),
			asking()
		);
		expect(compressed.headers.get('content-encoding')).toBe('br');

		const enhanced = enhanceHtmlResponseWithStreamingSlots(
			uncompressedPage(compressed),
			{
				streamingSlots: [
					{ id: 'slot', resolve: async () => '<p>resolved</p>' }
				]
			}
		);
		const html = await enhanced.text();

		expect(enhanced.headers.get('content-encoding')).toBeNull();
		expect(html).toContain('<div id="slot"');
		expect(html).toContain('resolved');
	});
});
