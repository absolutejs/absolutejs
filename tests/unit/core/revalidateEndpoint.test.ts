import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { RevalidationOutcome } from '../../../types/revalidate';
import { registerRevalidator } from '../../../src/core/revalidate';
import {
	REVALIDATE_ENDPOINT,
	revalidateEndpoint
} from '../../../src/core/revalidateEndpoint';

/* The revalidation endpoint: a public URL that makes the server render
 * pages. Most of what is asserted here is what it refuses to do. */

const TOKEN = 'a-long-random-secret-value';

const rendered: string[] = [];
const outcomes: Record<string, RevalidationOutcome> = {};
const tagged: Record<string, string[]> = {
	posts: ['/blog', '/blog/hello']
};

const register = () =>
	registerRevalidator({
		canCreate: (route) => route.startsWith('/blog/'),
		revalidate: (route) => {
			rendered.push(route);

			return Promise.resolve(outcomes[route] ?? 'replaced');
		},
		routes: () => ['/', '/blog', '/blog/hello', '/about'],
		routesTagged: (tags) => [
			...new Set(tags.flatMap((tag) => tagged[tag] ?? []))
		]
	});

const call = (
	app: { handle: (request: Request) => Promise<Response> },
	body: unknown,
	headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` }
) =>
	app.handle(
		new Request(`http://localhost${REVALIDATE_ENDPOINT}`, {
			body: typeof body === 'string' ? body : JSON.stringify(body),
			headers: { 'content-type': 'application/json', ...headers },
			method: 'POST'
		})
	);

beforeEach(() => {
	register();
});

afterEach(() => {
	rendered.length = 0;
	Object.keys(outcomes).forEach((route) => {
		Reflect.deleteProperty(outcomes, route);
	});
	registerRevalidator(undefined);
});

describe('whether the endpoint exists', () => {
	test('not without a token: the path is not a route at all', async () => {
		const response = await call(revalidateEndpoint(undefined), {
			all: true
		});

		expect(response.status).toBe(404);
		expect(rendered).toEqual([]);
	});

	/* `process.env.REVALIDATE_TOKEN ?? ''` in a config, on a machine
	 * where it is not set, must not open the endpoint to an empty
	 * bearer. */
	test('not with an empty token', async () => {
		const response = await call(
			revalidateEndpoint(''),
			{ all: true },
			{ authorization: 'Bearer ' }
		);

		expect(response.status).toBe(404);
	});

	test('not with a token too short to be a secret', async () => {
		const response = await call(
			revalidateEndpoint('hunter2'),
			{ all: true },
			{ authorization: 'Bearer hunter2' }
		);

		expect(response.status).toBe(404);
		expect(rendered).toEqual([]);
	});
});

describe('who may call it', () => {
	const app = revalidateEndpoint(TOKEN);

	test('a caller with the token', async () => {
		const response = await call(app, { paths: ['/about'] });

		expect(response.status).toBe(200);
		expect(rendered).toEqual(['/about']);
	});

	test.each([
		['no authorization header', {}],
		[
			'a wrong token',
			{ authorization: 'Bearer not-the-secret-value-at-all' }
		],
		[
			'a prefix of the token',
			{ authorization: `Bearer ${TOKEN.slice(0, -1)}` }
		],
		['the token with more after it', { authorization: `Bearer ${TOKEN}x` }],
		['the token without the scheme', { authorization: TOKEN }],
		['another scheme', { authorization: `Basic ${TOKEN}` }]
	])('not %s', async (_label, headers) => {
		const response = await call(app, { all: true }, headers);

		expect(response.status).toBe(401);
		expect(response.headers.get('www-authenticate')).toBe('Bearer');
		expect(rendered).toEqual([]);
	});

	/* Refused before the body is looked at: someone without the token
	 * learns nothing about what a valid request looks like. */
	test('a wrong token is refused the same way whatever the body', async () => {
		const wrong: Record<string, string> = {
			authorization: 'Bearer not-the-secret-value-at-all'
		};
		const valid = await call(app, { paths: ['/about'] }, wrong);
		const invalid = await call(app, { paths: 'nonsense' }, wrong);

		expect(valid.status).toBe(401);
		expect(invalid.status).toBe(401);
		expect(await valid.text()).toBe(await invalid.text());
	});

	test('only by POST', async () => {
		const response = await app.handle(
			new Request(`http://localhost${REVALIDATE_ENDPOINT}`, {
				headers: { authorization: `Bearer ${TOKEN}` }
			})
		);

		expect(response.status).toBe(404);
		expect(rendered).toEqual([]);
	});
});

describe('what it does', () => {
	const app = revalidateEndpoint(TOKEN);

	test('revalidates the paths it is given, and says what happened to each', async () => {
		outcomes['/blog/hello'] = 'removed';
		outcomes['/about'] = 'failed';

		const response = await call(app, {
			paths: ['/', '/blog/hello', '/about']
		});

		expect(await response.json()).toEqual({
			failed: ['/about'],
			removed: ['/blog/hello'],
			revalidated: ['/'],
			skipped: []
		});
	});

	test('revalidates the pages carrying a tag', async () => {
		const response = await call(app, { tags: ['posts'] });

		expect(await response.json()).toEqual({
			failed: [],
			removed: [],
			revalidated: ['/blog', '/blog/hello'],
			skipped: []
		});
	});

	test('renders a page once when a path and a tag both name it', async () => {
		await call(app, {
			paths: ['/blog/hello', '/blog/hello/'],
			tags: ['posts']
		});

		expect(
			rendered.filter((route) => route === '/blog/hello')
		).toHaveLength(1);
	});

	test('creates a page for a path the config covers', async () => {
		const response = await call(app, { paths: ['/blog/new-post'] });

		expect(await response.json()).toMatchObject({
			revalidated: ['/blog/new-post'],
			skipped: []
		});
	});

	/* The token is permission to say a page is stale. It is not
	 * permission to make the server pre-render any URL one can name. */
	test('skips a path the config does not cover, rendering nothing for it', async () => {
		const response = await call(app, {
			paths: ['/admin/secrets', '/about']
		});

		expect(await response.json()).toEqual({
			failed: [],
			removed: [],
			revalidated: ['/about'],
			skipped: ['/admin/secrets']
		});
		expect(rendered).toEqual(['/about']);
	});

	test('"all" revalidates every pre-rendered page', async () => {
		const response = await call(app, { all: true });

		expect(await response.json()).toMatchObject({
			revalidated: ['/', '/blog', '/blog/hello', '/about']
		});
	});

	/* A CMS gives a webhook a few seconds; re-rendering can take longer. */
	test('"background" answers at once and does the work afterwards', async () => {
		const response = await call(app, { background: true, tags: ['posts'] });

		expect(response.status).toBe(202);
		expect(await response.json()).toEqual({ accepted: true });
		await Bun.sleep(5);
		expect(rendered).toEqual(['/blog', '/blog/hello']);
	});

	test('answers with empty lists where nothing is pre-rendered', async () => {
		registerRevalidator(undefined);

		const response = await call(app, {
			paths: ['/about'],
			tags: ['posts']
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			failed: [],
			removed: [],
			revalidated: [],
			skipped: ['/about']
		});
	});
});

describe('a body it will not act on', () => {
	const app = revalidateEndpoint(TOKEN);

	test.each([
		['nothing to do', {}],
		['empty lists', { paths: [], tags: [] }],
		['paths that is not a list', { paths: '/about' }],
		['a path that is not a string', { paths: ['/about', 7] }],
		['tags that is not a list', { tags: { posts: true } }],
		['an array for a body', ['/about']]
	])('%s', async (_label, body) => {
		const response = await call(app, body);

		expect(response.status).toBe(400);
		expect(rendered).toEqual([]);
	});

	/* One call cannot be used to queue an unbounded number of renders. */
	test('more paths and tags than one call may name', async () => {
		const many = Array.from(
			{ length: 60 },
			(_, index) => `/blog/p${index}`
		);

		const response = await call(app, { paths: many, tags: many });

		expect(response.status).toBe(400);
		expect(await response.text()).toContain('at most 100');
		expect(rendered).toEqual([]);
	});

	test('a body that is not JSON', async () => {
		const response = await call(app, '{ not json');

		expect(response.status).toBeGreaterThanOrEqual(400);
		expect(response.status).toBeLessThan(500);
		expect(rendered).toEqual([]);
	});
});
