import { describe, expect, test } from 'bun:test';
import { Elysia, NotFound } from 'elysia';
import type {
	FileRouteContext,
	FileRouteDefinition,
	FileRouteRenderInput
} from '../../../types/fileRoutes';
import { defineFileRouteWith } from '../../../src/core/fileRouteAdapter';
import { fileRoutes } from '../../../src/core/fileRoutes';

const renderJson = async ({ props }: FileRouteRenderInput) =>
	Response.json(props);

const route = (path: string, overrides: Partial<FileRouteDefinition> = {}) => {
	const definition: FileRouteDefinition = {
		framework: 'react',
		name: `Route${path.replace(/\W/g, '')}`,
		path,
		render: renderJson,
		source: `react/routes${path}.tsx`,
		...overrides
	};

	return definition;
};

const request = (
	app: { handle: (request: Request) => Promise<Response> },
	path: string
) => app.handle(new Request(`http://localhost${path}`));

describe('fileRoutes', () => {
	test('serves each route with the props its load returns', async () => {
		const blog = defineFileRouteWith(
			'react',
			{
				name: 'RouteBlogSlug',
				path: '/blog/:slug',
				source: 'react/routes/blog/[slug].tsx',
				server: async () => ({
					load: ({
						params,
						query
					}: FileRouteContext<'/blog/:slug'>) => ({
						slug: params.slug,
						view: query.view ?? 'full'
					})
				})
			},
			renderJson
		);
		const app = new Elysia().use(fileRoutes([blog, route('/about')], {}));

		expect(await (await request(app, '/blog/hi?view=card')).json()).toEqual(
			{
				slug: 'hi',
				view: 'card'
			}
		);
		expect(await (await request(app, '/about')).json()).toEqual({});
		expect((await request(app, '/missing')).status).toBe(404);
	});

	test('passes the manifest and request to render', async () => {
		const seen: string[] = [];
		const app = new Elysia().use(
			fileRoutes(
				[
					route('/', {
						render: async ({ manifest, request: incoming }) => {
							seen.push(
								manifest.RouteIndex ?? '',
								new URL(incoming.url).pathname
							);

							return new Response('ok');
						}
					})
				],
				{ RouteIndex: '/react/indexes/RouteIndex.js' }
			)
		);
		await request(app, '/');

		expect(seen).toEqual(['/react/indexes/RouteIndex.js', '/']);
	});

	test('beforeHandle can answer the request', async () => {
		const guarded = defineFileRouteWith(
			'react',
			{
				name: 'RouteAdmin',
				path: '/admin',
				source: 'react/routes/admin.tsx',
				server: async () => ({
					beforeHandle: ({
						headers,
						redirect
					}: FileRouteContext<'/admin'>) =>
						headers.authorization ? undefined : redirect('/login')
				})
			},
			async () => new Response('ADMIN')
		);
		const app = new Elysia().use(fileRoutes([guarded], {}));
		const denied = await request(app, '/admin');
		const allowed = await app.handle(
			new Request('http://localhost/admin', {
				headers: { authorization: 'yes' }
			})
		);

		expect(denied.status).toBe(302);
		expect(denied.headers.get('location')).toBe('/login');
		expect(await allowed.text()).toBe('ADMIN');
	});

	test('load can redirect, 404 or fail into the error page', async () => {
		const app = new Elysia().use(
			fileRoutes(
				[
					route('/moved', {
						load: async () =>
							new Response(null, {
								headers: { location: '/new' },
								status: 301
							})
					}),
					route('/gone', {
						load: async () => {
							throw new NotFound();
						}
					}),
					route('/broken', {
						load: async () => {
							throw new Error('LOAD_EXPLODED');
						}
					})
				],
				{}
			)
		);
		const originalError = console.error;
		console.error = () => undefined;
		try {
			expect((await request(app, '/moved')).status).toBe(301);
			expect((await request(app, '/gone')).status).toBe(404);
			const broken = await request(app, '/broken');
			expect(broken.status).toBe(500);
			const brokenBody = await broken.text();
			// Outside development the page gets a generic message, not the error's.
			expect(brokenBody).toContain(
				'Something went wrong while rendering this page.'
			);
			expect(brokenBody).not.toContain('LOAD_EXPLODED');
		} finally {
			console.error = originalError;
		}
	});

	test('explicit routes win in either order', async () => {
		const routes = [route('/before'), route('/after'), route('/both')];
		const app = new Elysia()
			.get('/before', () => 'EXPLICIT_BEFORE')
			.use(fileRoutes(routes, {}))
			.get('/after', () => 'EXPLICIT_AFTER');

		expect(await (await request(app, '/before')).text()).toBe(
			'EXPLICIT_BEFORE'
		);
		expect(await (await request(app, '/after')).text()).toBe(
			'EXPLICIT_AFTER'
		);
		expect(await (await request(app, '/both')).json()).toEqual({});
	});

	test('a static file route wins over a param route at the same depth', async () => {
		const app = new Elysia().use(
			fileRoutes(
				[
					route('/blog/:slug', {
						render: async () => new Response('PARAM')
					}),
					route('/blog/new', {
						render: async () => new Response('STATIC')
					})
				],
				{}
			)
		);

		expect(await (await request(app, '/blog/new')).text()).toBe('STATIC');
		expect(await (await request(app, '/blog/other')).text()).toBe('PARAM');
	});

	test('app-wide hooks registered before fileRoutes() guard file routes', async () => {
		const app = new Elysia()
			.onBeforeHandle(({ request: incoming }) =>
				incoming.headers.get('authorization')
					? undefined
					: new Response('DENIED', { status: 401 })
			)
			.use(fileRoutes([route('/account')], {}));
		const denied = await request(app, '/account');
		const allowed = await app.handle(
			new Request('http://localhost/account', {
				headers: { authorization: 'yes' }
			})
		);

		expect(denied.status).toBe(401);
		expect(allowed.status).toBe(200);
	});
});
