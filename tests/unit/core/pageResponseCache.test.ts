import { describe, expect, test } from 'bun:test';
import {
	streamingPageHeaders,
	withPageCacheHeaders
} from '../../../src/core/pageResponseCache';

const html = (body = '<!DOCTYPE html><html><body>hi</body></html>') =>
	new Response(body, { headers: { 'Content-Type': 'text/html' } });

const requestWithEtag = (etag: string) =>
	new Request('http://x/', { headers: { 'if-none-match': etag } });

describe('withPageCacheHeaders', () => {
	test('stamps an HTML shell with no-cache + an ETag', async () => {
		const out = await withPageCacheHeaders(html());

		expect(out.headers.get('cache-control')).toBe('no-cache');
		expect(out.headers.get('etag')).toMatch(/^W\/"/);
		expect(await out.text()).toContain('hi');
	});

	test('returns 304 with empty body when If-None-Match matches', async () => {
		const first = await withPageCacheHeaders(html());
		const etag = first.headers.get('etag') ?? '';

		const revalidated = await withPageCacheHeaders(
			html(),
			requestWithEtag(etag)
		);

		expect(revalidated.status).toBe(304);
		expect(revalidated.headers.get('etag')).toBe(etag);
		expect(await revalidated.text()).toBe('');
	});

	test('serves a fresh 200 when the content (ETag) changed', async () => {
		const first = await withPageCacheHeaders(html('<html>v1</html>'));
		const stale = first.headers.get('etag') ?? '';

		const next = await withPageCacheHeaders(
			html('<html>v2</html>'),
			requestWithEtag(stale)
		);

		expect(next.status).toBe(200);
		expect(next.headers.get('etag')).not.toBe(stale);
		expect(await next.text()).toContain('v2');
	});

	test('streaming responses get no-cache, no ETag, marker stripped', async () => {
		const streamed = new Response('streamed', {
			headers: streamingPageHeaders()
		});
		const out = await withPageCacheHeaders(streamed);

		expect(out.headers.get('cache-control')).toBe('no-cache');
		expect(out.headers.get('etag')).toBeNull();
		expect(out.headers.get('x-absolute-stream')).toBeNull();
	});

	test('bufferStreamForEtag buffers a streamed page into an ETagged 200', async () => {
		const streamed = new Response('<html>streamed</html>', {
			headers: streamingPageHeaders()
		});
		const out = await withPageCacheHeaders(streamed, undefined, {
			bufferStreamForEtag: true
		});

		expect(out.headers.get('cache-control')).toBe('no-cache');
		expect(out.headers.get('etag')).toMatch(/^W\/"/);
		expect(out.headers.get('x-absolute-stream')).toBeNull();
		expect(await out.text()).toContain('streamed');
	});

	test('bufferStreamForEtag lets a streamed page revalidate to 304', async () => {
		const first = await withPageCacheHeaders(
			new Response('<html>streamed</html>', {
				headers: streamingPageHeaders()
			}),
			undefined,
			{ bufferStreamForEtag: true }
		);
		const etag = first.headers.get('etag') ?? '';

		const revalidated = await withPageCacheHeaders(
			new Response('<html>streamed</html>', {
				headers: streamingPageHeaders()
			}),
			requestWithEtag(etag),
			{ bufferStreamForEtag: true }
		);

		expect(revalidated.status).toBe(304);
		expect(revalidated.headers.get('etag')).toBe(etag);
		expect(await revalidated.text()).toBe('');
	});

	test('non-HTML responses pass through untouched', async () => {
		const json = new Response('{}', {
			headers: { 'Content-Type': 'application/json' }
		});
		const out = await withPageCacheHeaders(json);

		expect(out.headers.get('cache-control')).toBeNull();
		expect(out.headers.get('etag')).toBeNull();
	});

	test('redirects (no content-type) pass through untouched', async () => {
		const redirect = new Response(null, {
			headers: { Location: '/signin' },
			status: 302
		});
		const out = await withPageCacheHeaders(redirect);

		expect(out.status).toBe(302);
		expect(out.headers.get('cache-control')).toBeNull();
	});
});
