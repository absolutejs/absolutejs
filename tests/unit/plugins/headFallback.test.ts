import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { headFallback } from '../../../src/plugins/headFallback';

describe('HEAD fallback', () => {
	test('HEAD answers with the GET route status and headers, and no body', async () => {
		const app = headFallback(
			new Elysia()
				.get('/', () => 'home')
				.get(
					'/logo.png',
					() =>
						new Response('png-bytes', {
							headers: { 'content-type': 'image/png' }
						})
				)
		);
		const page = await app.handle(
			new Request('http://x/', { method: 'HEAD' })
		);
		expect(page.status).toBe(200);
		expect(await page.text()).toBe('');
		const asset = await app.handle(
			new Request('http://x/logo.png', { method: 'HEAD' })
		);
		expect(asset.status).toBe(200);
		expect(asset.headers.get('content-type')).toBe('image/png');
		const missing = await app.handle(
			new Request('http://x/missing', { method: 'HEAD' })
		);
		expect(missing.status).toBe(404);
	});

	test("an app's own HEAD route wins", async () => {
		const app = headFallback(
			new Elysia()
				.get('/', () => 'home')
				.head(
					'/',
					() => new Response(null, { headers: { 'x-own': '1' } })
				)
		);
		const response = await app.handle(
			new Request('http://x/', { method: 'HEAD' })
		);
		expect(response.headers.get('x-own')).toBe('1');
	});
});
