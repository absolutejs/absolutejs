import { describe, expect, test } from 'bun:test';
import { Elysia, NotFound } from 'elysia';
import type {
	FileRouteContext,
	FileRouteDefinition,
	FileRouteRenderInput
} from '../../../types/fileRoutes';
import {
	defineFileRouteWith,
	type FileRouteAdapterInput
} from '../../../src/core/fileRouteAdapter';
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

/** The keys `FileRouteContext` documents, so a test can ask what ELSE
 *  arrived. */
const KNOWN_CONTEXT_KEYS = new Set([
	'headers',
	'params',
	'path',
	'query',
	'redirect',
	'request',
	'set'
]);

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

	/* `docs/[...rest].tsx` registers `/docs/*`, where Elysia names the param
	 * `*`. The file named it `rest`, and `params.rest` is what the route's
	 * types promise, so the runtime fills that in. `*` stays readable too. */
	test('a catch-all route reads its param under the name the file gave it', async () => {
		const docs = defineFileRouteWith(
			'react',
			{
				catchAll: 'rest',
				name: 'RouteDocsRest',
				path: '/docs/*',
				source: 'react/routes/docs/[...rest].tsx',
				typePath: '/docs/:rest',
				server: async () => ({
					load: ({ params }: FileRouteContext<'/docs/:rest'>) => ({
						rest: params.rest,
						wildcard: Reflect.get(params, '*')
					})
				})
			},
			renderJson
		);
		const app = new Elysia().use(fileRoutes([docs], {}));

		expect(await (await request(app, '/docs/a/b/c')).json()).toEqual({
			rest: 'a/b/c',
			wildcard: 'a/b/c'
		});
		/* `/docs/` matches with nothing after it. The param is typed
		 * `string`, so it arrives as one — and `load` still runs, which it
		 * would not if an empty match were treated as a missing param. */
		expect(await (await request(app, '/docs/')).json()).toEqual({
			rest: '',
			wildcard: ''
		});
	});

	/* An `[[optional]]` segment registers two paths for one page, and on the
	 * shorter one the param is absent. The required-params check that stands
	 * between a request and `load` has to know that, or `load` never runs on
	 * half of the route's own paths and the page silently renders with no
	 * props at all. */
	test('an optional param route runs its load with and without the param', async () => {
		const server = async () => ({
			load: ({ params }: FileRouteContext<'/:lang?/about'>) => ({
				lang: params.lang ?? 'default'
			})
		});
		// Everything the two registrations share — one page, two paths.
		const shared: Omit<FileRouteAdapterInput, 'path'> & {
			server: typeof server;
		} = {
			name: 'RouteLangAbout',
			server,
			source: 'react/routes/[[lang]]/about.tsx',
			typePath: '/:lang?/about'
		};
		const app = new Elysia().use(
			fileRoutes(
				[
					defineFileRouteWith(
						'react',
						{ ...shared, path: '/:lang/about' },
						renderJson
					),
					defineFileRouteWith(
						'react',
						{ ...shared, path: '/about' },
						renderJson
					)
				],
				{}
			)
		);

		expect(await (await request(app, '/fr/about')).json()).toEqual({
			lang: 'fr'
		});
		expect(await (await request(app, '/about')).json()).toEqual({
			lang: 'default'
		});
	});

	/* What a plugin derived reaches `load`, and what Elysia put on the
	 * context does not. The first half is the feature; the second is why
	 * it is a deny-list of Elysia's keys rather than a copy of the whole
	 * context, which would hand every route `store`, `route`, `qi` and
	 * `url` as though a plugin had derived them. */
	test('passes plugin-derived context to load, and nothing of Elysia own', async () => {
		const account = defineFileRouteWith(
			'react',
			{
				name: 'RouteAccount',
				path: '/account',
				source: 'react/routes/account.tsx',
				server: async () => ({
					load: (context: FileRouteContext<'/account'>) => ({
						derivedKeys: Object.keys(context)
							.filter((key) => !KNOWN_CONTEXT_KEYS.has(key))
							.sort(),
						session: Reflect.get(context, 'session')
					})
				})
			},
			renderJson
		);
		const app = new Elysia()
			.derive(() => ({ session: { user: 'u1' } }))
			.derive(() => ({ tenant: 'acme' }))
			.use(fileRoutes([account], {}));

		/* An exact list, not a `toContain`: the point of the deny-list is
		 * that Elysia's own keys — `store`, `route`, `qi`, `~sig` — do NOT
		 * arrive, and only an exact assertion fails when a later Elysia
		 * adds one. */
		expect(await (await request(app, '/account')).json()).toEqual({
			derivedKeys: ['session', 'tenant'],
			session: { user: 'u1' }
		});
	});

	/* Recorded because it is the opposite of what a reader would assume:
	 * a plugin that derives a key Elysia's context already owns REPLACES
	 * it, and the route's own value is gone before `fileRoutes()` sees the
	 * context. The deny-list keeps such a key from being copied twice; it
	 * cannot put back params Elysia overwrote. Deriving `params` is
	 * pathological, so this documents the behaviour rather than guarding
	 * against it. */
	test('a plugin that derives a key Elysia owns replaces it', async () => {
		const blog = defineFileRouteWith(
			'react',
			{
				name: 'RouteBlogSlug',
				path: '/blog/:slug',
				source: 'react/routes/blog/[slug].tsx',
				server: async () => ({
					load: ({ params }: FileRouteContext<'/blog/:slug'>) => ({
						slug: params.slug
					})
				})
			},
			renderJson
		);
		const app = new Elysia()
			.derive(() => ({ params: { slug: 'DERIVED' } }))
			.use(fileRoutes([blog], {}));

		expect(await (await request(app, '/blog/real')).json()).toEqual({
			slug: 'DERIVED'
		});
	});

	/* `beforeHandle` too, which is the half that makes the feature useful:
	 * a route guard is the main reason to want the session, and it is a
	 * separate call into the same context builder. */
	test('a beforeHandle guard sees the derived session', async () => {
		const account = defineFileRouteWith(
			'react',
			{
				name: 'RouteAccount',
				path: '/account',
				source: 'react/routes/account.tsx',
				server: async () => ({
					beforeHandle: (context: FileRouteContext<'/account'>) =>
						Reflect.get(context, 'session') === null
							? context.redirect('/login')
							: undefined,
					load: () => ({ ok: true })
				})
			},
			renderJson
		);
		const signedIn = new Elysia()
			.derive(() => ({ session: { user: 'u1' } }))
			.use(fileRoutes([account], {}));
		const signedOut = new Elysia()
			.derive(() => ({ session: null }))
			.use(fileRoutes([account], {}));
		const guarded = await request(signedOut, '/account');

		expect(guarded.status).toBe(302);
		expect(guarded.headers.get('location')).toBe('/login');
		expect(await (await request(signedIn, '/account')).json()).toEqual({
			ok: true
		});
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
