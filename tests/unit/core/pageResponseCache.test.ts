import { describe, expect, test } from 'bun:test';
import {
	consumeActionFlash,
	encodeActionFlash
} from '../../../src/core/formActionFlash';
import {
	streamingPageHeaders,
	withPageCacheHeaders
} from '../../../src/core/pageResponseCache';
import type { ActionFlash } from '../../../src/utils/formActionState';

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

/* A form posted without JavaScript is answered with a redirect back to
 * the page and its result in a cookie; the page then has the errors and
 * typed values written into it for that one request. Both shortcuts here
 * used to get in the way of that: the browser revalidated, was told 304,
 * and showed its cached copy with an empty form and no error. */
describe('withPageCacheHeaders — a request carrying a form result', () => {
	const flash: ActionFlash = {
		action: '/actions/contact',
		result: {
			errors: { message: 'Message is too short' },
			status: 'error',
			values: { message: 'hey' }
		}
	};
	const flashCookie = () =>
		(encodeActionFlash(flash, false).split(';')[0] ?? '').trim();

	const formPage = (padding = '') =>
		`<!DOCTYPE html><html><body><form method="post" action="/actions/contact" data-absolute-action><textarea name="message"></textarea><p id="message-error" data-action-error="message" hidden></p></form>${padding}</body></html>`;

	test('is not answered 304, though the page itself is unchanged', async () => {
		const first = await withPageCacheHeaders(html(formPage()));
		const etag = first.headers.get('etag') ?? '';
		const request = new Request('http://x/contact', {
			headers: { cookie: flashCookie(), 'if-none-match': etag }
		});

		const out = await withPageCacheHeaders(html(formPage()), request);

		expect(out.status).toBe(200);
		expect(await out.text()).toContain('data-action-error');
	});

	test('is not compressed, so the result can still be written in', async () => {
		const large = formPage('<p>filler</p>'.repeat(400));
		const request = new Request('http://x/contact', {
			headers: { 'accept-encoding': 'br, gzip', cookie: flashCookie() }
		});

		const out = await withPageCacheHeaders(html(large), request);

		expect(out.headers.get('content-encoding')).toBeNull();
	});

	/* The whole path a browser takes: revalidating, accepting compression,
	 * on a page large enough to compress. */
	test('ends up with the error and the typed value in the page', async () => {
		const large = formPage('<p>filler</p>'.repeat(400));
		const first = await withPageCacheHeaders(html(large));
		const request = new Request('http://x/contact', {
			headers: {
				'accept-encoding': 'br, gzip',
				cookie: flashCookie(),
				'if-none-match': first.headers.get('etag') ?? ''
			}
		});

		const cached = await withPageCacheHeaders(html(large), request);
		const answered = consumeActionFlash(request, cached);
		const body = (await answered?.text()) ?? '';

		expect(answered?.status).toBe(200);
		expect(body).toContain('Message is too short');
		expect(body).toContain('>hey</textarea>');
		expect(answered?.headers.get('cache-control')).toBe('no-store');
		expect(answered?.headers.get('etag')).toBeNull();
	});

	test('a request without one still gets its 304 and its compression', async () => {
		const large = formPage('<p>filler</p>'.repeat(400));
		const compressed = await withPageCacheHeaders(
			html(large),
			new Request('http://x/contact', {
				headers: { 'accept-encoding': 'br, gzip' }
			})
		);

		expect(compressed.headers.get('content-encoding')).not.toBeNull();

		const revalidated = await withPageCacheHeaders(
			html(large),
			new Request('http://x/contact', {
				headers: {
					'accept-encoding': 'br, gzip',
					'if-none-match': compressed.headers.get('etag') ?? ''
				}
			})
		);

		expect(revalidated.status).toBe(304);
	});
});
