import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { routingRules } from '../../../src/plugins/routingRules';
import type { RoutingRulesConfig } from '../../../types/routingRules';

/* The plugin against a real Elysia app. There is no server here, so a
 * rewrite is sent back through the app's own `handle`; the integration
 * test covers the running server's `fetch`. */

const build = (config: RoutingRulesConfig) => {
	const app = new Elysia();
	app.use(
		routingRules(config, { dispatch: (request) => app.handle(request) })
	)
		.get('/plans/pricing', () => 'pricing')
		.get('/products/:id', ({ params, query }) =>
			JSON.stringify({ id: params.id, tab: query.tab ?? null })
		)
		.post('/products/:id', async ({ params, request }) =>
			JSON.stringify({ body: await request.text(), id: params.id })
		)
		.get('/own-cache', ({ set }) => {
			set.headers['cache-control'] = 'no-store';

			return 'own';
		})
		.get(
			'/response-cache',
			() =>
				new Response('response', {
					headers: { 'cache-control': 'private' }
				})
		)
		.get('/hidden', () => 'hidden');

	return (path: string, init?: RequestInit) =>
		app.handle(new Request(`http://localhost${path}`, init));
};

describe('a redirect rule', () => {
	const request = build({
		redirects: [
			{ from: '/old-pricing', to: '/plans/pricing' },
			{ from: '/blog/:slug', status: 301, to: '/posts/:slug' }
		]
	});

	test('answers before any route is looked up', async () => {
		const response = await request('/old-pricing?ref=mail');

		expect(response.status).toBe(308);
		expect(response.headers.get('location')).toBe(
			'/plans/pricing?ref=mail'
		);
	});

	test('answers for a path no route serves', async () => {
		const response = await request('/blog/hello');

		expect(response.status).toBe(301);
		expect(response.headers.get('location')).toBe('/posts/hello');
	});

	test('leaves every other request alone', async () => {
		const response = await request('/plans/pricing');

		expect(response.status).toBe(200);
		expect(await response.text()).toBe('pricing');
	});
});

describe('a rewrite rule', () => {
	const request = build({
		redirects: [{ from: '/hidden', to: '/plans/pricing' }],
		rewrites: [
			{ from: '/p/:id', to: '/products/:id' },
			{ from: '/secret', to: '/hidden' }
		]
	});

	test('serves the other route, params and query included', async () => {
		const response = await request('/p/42?tab=reviews');

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ id: '42', tab: 'reviews' });
	});

	test('carries the method and the body', async () => {
		const response = await request('/p/7', {
			body: 'hello',
			method: 'POST'
		});

		expect(await response.json()).toEqual({ body: 'hello', id: '7' });
	});

	/* `/secret` is rewritten to `/hidden`, and `/hidden` has a redirect.
	 * Following it would send the visitor to the address the rewrite was
	 * there to keep out of sight. */
	test('is not redirected a second time at its destination', async () => {
		const response = await request('/secret');

		expect(response.status).toBe(200);
		expect(await response.text()).toBe('hidden');
	});

	test('to a path nothing serves is a 404, not a loop', async () => {
		const missing = build({ rewrites: [{ from: '/a', to: '/nowhere' }] });

		expect((await missing('/a')).status).toBe(404);
	});
});

describe('header rules', () => {
	const request = build({
		headers: [
			{ headers: { 'x-frame-options': 'DENY' }, path: '/*' },
			{
				headers: { 'cache-control': 'public, max-age=60' },
				path: '/*'
			}
		],
		redirects: [{ from: '/old-pricing', to: '/plans/pricing' }],
		rewrites: [{ from: '/p/:id', to: '/products/:id' }]
	});

	test('are added to a route that sets none of its own', async () => {
		const response = await request('/plans/pricing');

		expect(response.headers.get('x-frame-options')).toBe('DENY');
		expect(response.headers.get('cache-control')).toBe(
			'public, max-age=60'
		);
	});

	test('give way to a header the route sets', async () => {
		const response = await request('/own-cache');

		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.get('x-frame-options')).toBe('DENY');
	});

	test('give way to a header on a returned Response', async () => {
		const response = await request('/response-cache');

		expect(response.headers.get('cache-control')).toBe('private');
		expect(response.headers.get('x-frame-options')).toBe('DENY');
	});

	test('reach a redirect and a rewritten response too', async () => {
		expect(
			(await request('/old-pricing')).headers.get('x-frame-options')
		).toBe('DENY');
		expect((await request('/p/1')).headers.get('x-frame-options')).toBe(
			'DENY'
		);
	});
});

describe('with no rules', () => {
	test('the plugin adds nothing', async () => {
		const request = build({});
		const response = await request('/plans/pricing');

		expect(response.status).toBe(200);
		expect(response.headers.get('x-frame-options')).toBeNull();
	});

	test('a malformed rule stops the app being built', () => {
		expect(() =>
			build({ redirects: [{ from: 'old', to: '/new' }] })
		).toThrow(/redirects\[0\]\.from must be a path starting with "\/"/);
	});
});
