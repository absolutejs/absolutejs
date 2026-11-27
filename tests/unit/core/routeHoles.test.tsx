import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Elysia } from 'elysia';
import { defineComponent, h } from 'vue';
import {
	PARTIAL_SHELL_HEADER,
	readPartialHoles,
	writePartialHoles
} from '../../../src/core/partialPrerender';
import { servePartialPrerender } from '../../../src/core/partialPrerenderServe';
import {
	renderedNonce,
	writeRenderedNonce
} from '../../../src/core/prerenderNonce';
import { defineFileRouteWith } from '../../../src/core/fileRouteAdapter';
import { fileRoutes } from '../../../src/core/fileRoutes';
import { absoluteRequestContext } from '../../../src/core/requestContext';
import {
	defineHoles,
	holeComponent,
	registerRouteHoles,
	routeHoleSlots
} from '../../../src/core/routeHoles';
import { StreamSlot } from '../../../src/react/components';
import { handleReactPageRequest } from '../../../src/react';

/* Route-level holes: a pre-rendered page's dynamic parts declared beside
 * the route, so that filling them does not mean running the route and
 * rendering the page again.
 *
 * The registry is one per process, so every case here uses a path of
 * its own. */

const BYPASS = 'X-Absolute-Prerender-Bypass';

const directories: string[] = [];
afterAll(async () => {
	await Promise.all(
		directories.map((dir) => rm(dir, { force: true, recursive: true }))
	);
});

const userFrom = (request: Request) =>
	request.headers.get('cookie')?.match(/user=(\w+)/)?.[1] ?? 'guest';

const requestFor = (path: string, cookie = '') =>
	new Request(`http://localhost${path}`, { headers: { cookie } });

/* What a slot resolves to, as the stream would ask it. */
const resolved = async (
	slots: Awaited<ReturnType<typeof routeHoleSlots>>,
	id: string
) => {
	const slot = slots?.find((candidate) => candidate.id === id);
	if (!slot) throw new Error(`no slot ${id}`);

	return slot.resolve();
};

describe('the holes a route declares', () => {
	test('are given the visitor’s request', async () => {
		defineHoles('/holes/account', {
			greeting: ({ request }) => `<p>hello ${userFrom(request)}</p>`
		});

		const slots = await routeHoleSlots(
			requestFor('/holes/account', 'user=ada'),
			['greeting']
		);

		expect(await resolved(slots, 'greeting')).toBe('<p>hello ada</p>');
	});

	test('are given the route’s params, decoded', async () => {
		defineHoles('/holes/posts/:slug', {
			views: ({ params }) => `<p>${params.slug}</p>`
		});

		const slots = await routeHoleSlots(requestFor('/holes/posts/a%20b'), [
			'views'
		]);

		expect(await resolved(slots, 'views')).toBe('<p>a b</p>');
	});

	test('an optional param is absent, not empty, on the path without it', async () => {
		defineHoles('/holes/shop/:category?', {
			crumb: ({ params }) => `<p>${params.category ?? 'everything'}</p>`
		});

		const all = await routeHoleSlots(requestFor('/holes/shop'), ['crumb']);
		const hats = await routeHoleSlots(requestFor('/holes/shop/hats'), [
			'crumb'
		]);

		expect(await resolved(all, 'crumb')).toBe('<p>everything</p>');
		expect(await resolved(hats, 'crumb')).toBe('<p>hats</p>');
	});

	/* A file route names its catch-all; Elysia calls it `*`. The name
	 * the file gave is the one its `holes` were written against. */
	test('a catch-all arrives under the name the route file gave it', async () => {
		registerRouteHoles(
			'/holes/docs/*',
			() => ({ path: ({ params }) => `<p>${params.rest}</p>` }),
			'rest'
		);

		const slots = await routeHoleSlots(
			requestFor('/holes/docs/guide/routing'),
			['path']
		);

		expect(await resolved(slots, 'path')).toBe('<p>guide/routing</p>');
	});

	test('a literal path is preferred to a pattern that also matches', async () => {
		defineHoles('/holes/items/:id', { which: () => 'pattern' });
		defineHoles('/holes/items/new', { which: () => 'literal' });

		const slots = await routeHoleSlots(requestFor('/holes/items/new'), [
			'which'
		]);

		expect(await resolved(slots, 'which')).toBe('literal');
	});

	test('declared again for a path, replace what was there', async () => {
		defineHoles('/holes/replaced', { which: () => 'first' });
		defineHoles('/holes/replaced', { which: () => 'second' });

		const slots = await routeHoleSlots(requestFor('/holes/replaced'), [
			'which'
		]);

		expect(await resolved(slots, 'which')).toBe('second');
	});

	test('a trailing slash and a query are the same route', async () => {
		defineHoles('/holes/slashed', { which: () => 'found' });

		const slots = await routeHoleSlots(
			requestFor('/holes/slashed/?tab=2'),
			['which']
		);

		expect(await resolved(slots, 'which')).toBe('found');
	});

	test('a route that declared none has none', async () => {
		expect(
			await routeHoleSlots(requestFor('/holes/undeclared'), ['any'])
		).toBeUndefined();
	});

	/* One slot the route did not declare means the page has to be
	 * rendered to reach it — and then it is rendered for all of them. */
	test('do not stand in for the page unless they cover every hole', async () => {
		defineHoles('/holes/partly', { one: () => 'one' });

		expect(
			await routeHoleSlots(requestFor('/holes/partly'), ['one', 'two'])
		).toBeUndefined();
	});

	test('a file route’s are loaded when a request first needs them', async () => {
		const loads: string[] = [];
		registerRouteHoles('/holes/lazy', async () => {
			loads.push('loaded');

			return { which: () => 'lazy' };
		});
		expect(loads).toEqual([]);

		const slots = await routeHoleSlots(requestFor('/holes/lazy'), [
			'which'
		]);

		expect(await resolved(slots, 'which')).toBe('lazy');
		expect(loads).toEqual(['loaded']);
	});
});

describe('a file route', () => {
	/* `export const holes` in `<route>.server.ts`: found through the
	 * route's own lazy import of that module, and registered under the
	 * route's path when the routes are mounted. */
	test('declares its holes with an export of its server module', async () => {
		const imports: string[] = [];
		const route = defineFileRouteWith(
			'react',
			{
				name: 'Post',
				path: '/holes/file/:slug',
				source: 'react/routes/holes/file/[slug].tsx',
				server: async () => {
					imports.push('imported');

					return {
						holes: {
							views: ({
								params
							}: {
								params: Record<string, string | undefined>;
							}) => `<p>views of ${params.slug}</p>`
						}
					};
				}
			},
			async () => new Response('the page')
		);
		fileRoutes([route], {})(new Elysia());
		// Mounting the routes imports nothing.
		expect(imports).toEqual([]);

		const slots = await routeHoleSlots(requestFor('/holes/file/first'), [
			'views'
		]);

		expect(await resolved(slots, 'views')).toBe('<p>views of first</p>');
	});

	test('with a server module that exports none has none', async () => {
		const route = defineFileRouteWith(
			'react',
			{
				name: 'Plain',
				path: '/holes/file-plain',
				source: 'react/routes/holes/file-plain.tsx',
				server: async () => ({ load: () => ({}) })
			},
			async () => new Response('the page')
		);
		fileRoutes([route], {})(new Elysia());

		expect(
			await routeHoleSlots(requestFor('/holes/file-plain'), ['any'])
		).toBeUndefined();
	});
});

describe('a hole that resolves to a component', () => {
	const Cart = ({ count }: { count: number }) => (
		<p className="cart">{count} items</p>
	);

	test('is rendered on its own, with the props it was given', async () => {
		defineHoles('/holes/react-component', {
			cart: () => holeComponent.react(Cart, { count: 3 })
		});

		const slots = await routeHoleSlots(
			requestFor('/holes/react-component'),
			['cart']
		);
		const html = await resolved(slots, 'cart');

		expect(html).toContain('class="cart"');
		expect(String(html).replace(/<!-- -->/g, '')).toContain('3 items');
	});

	test('may be of another framework than the page', async () => {
		const Badge = defineComponent({
			props: { label: { required: true, type: String } },
			setup: (props) => () => h('span', { class: 'badge' }, props.label)
		});
		defineHoles('/holes/vue-component', {
			badge: () => holeComponent.vue(Badge, { label: 'new' })
		});

		const slots = await routeHoleSlots(requestFor('/holes/vue-component'), [
			'badge'
		]);

		expect(await resolved(slots, 'badge')).toBe(
			'<span class="badge">new</span>'
		);
	});

	test('that is neither HTML nor a component fails, naming the hole', async () => {
		defineHoles('/holes/wrong', {
			// What a resolver written without the types could return.
			// @ts-expect-error a number is not hole content
			broken: () => 42
		});

		const slots = await routeHoleSlots(requestFor('/holes/wrong'), [
			'broken'
		]);

		expect(resolved(slots, 'broken')).rejects.toThrow('Hole "broken"');
	});
});

/* The point of all of it: the route is not run. */

type Ran = { handler: number; pageSlot: number };

const pageFor = (ran: Ran, path: string) => {
	const Page = ({ user }: { user: string }) => (
		<html lang="en">
			<head>
				<title>Holes</title>
			</head>
			<body>
				<nav>static navigation</nav>
				<StreamSlot
					dynamic
					fallbackHtml="<p>greeting loading</p>"
					id="greeting"
					resolve={() => {
						ran.pageSlot += 1;

						return `<section>page says hello ${user}</section>`;
					}}
				/>
				<StreamSlot
					dynamic
					fallbackHtml="<p>cart loading</p>"
					id="cart"
				/>
			</body>
		</html>
	);

	return new Elysia().use(absoluteRequestContext).get(path, ({ request }) => {
		ran.handler += 1;

		return handleReactPageRequest({
			collectStreamingSlots: true,
			index: '/holes-index.js',
			Page,
			props: { user: userFrom(request) }
		});
	});
};

type App = ReturnType<typeof pageFor>;

const captureShell = async (app: App, path: string) => {
	const response = await app.handle(
		new Request(`http://localhost${path}`, {
			headers: { [PARTIAL_SHELL_HEADER]: '1' }
		})
	);
	const dir = await mkdtemp(join(tmpdir(), 'absolute-route-holes-'));
	directories.push(dir);
	const filePath = join(dir, 'index.html');
	await Bun.write(filePath, await response.text());
	await writeRenderedNonce(filePath, renderedNonce(response));
	await writePartialHoles(filePath, response);

	return filePath;
};

const serve = async (app: App, filePath: string, path: string) => {
	const { response } = await servePartialPrerender({
		bypassHeader: BYPASS,
		filePath,
		holes: readPartialHoles(filePath),
		request: requestFor(path, 'user=ada'),
		handle: (inner) => app.handle(inner)
	});

	return response.text();
};

describe('serving a shell whose route declares its holes', () => {
	test('fills them without running the route or rendering the page', async () => {
		const ran: Ran = { handler: 0, pageSlot: 0 };
		const path = '/holes/served';
		const app = pageFor(ran, path);
		defineHoles(path, {
			cart: ({ request }) => `<p>cart of ${userFrom(request)}</p>`,
			greeting: ({ request }) =>
				`<section>route says hello ${userFrom(request)}</section>`
		});
		const filePath = await captureShell(app, path);
		expect(readPartialHoles(filePath)).toEqual(['greeting', 'cart']);
		// Capturing the shell is the one time the route runs.
		expect(ran).toEqual({ handler: 1, pageSlot: 0 });

		const html = await serve(app, filePath, path);

		expect(html).toContain('static navigation');
		expect(html).toContain('route says hello ada');
		expect(html).toContain('cart of ada');
		expect(html.trimEnd().endsWith('</html>')).toBe(true);
		expect(ran).toEqual({ handler: 1, pageSlot: 0 });
	});

	test('runs the route as before when one hole is not declared', async () => {
		const ran: Ran = { handler: 0, pageSlot: 0 };
		const path = '/holes/served-partly';
		const app = pageFor(ran, path);
		defineHoles(path, {
			cart: ({ request }) => `<p>cart of ${userFrom(request)}</p>`
		});
		const filePath = await captureShell(app, path);

		const html = await serve(app, filePath, path);

		// The page's own resolver for the one, the route's for the other.
		expect(html).toContain('page says hello ada');
		expect(html).toContain('cart of ada');
		expect(ran).toEqual({ handler: 2, pageSlot: 1 });
	});
});

describe('a page rendered in full', () => {
	const read = async (app: App, path: string) =>
		(await app.handle(requestFor(path, 'user=ada'))).text();

	/* Development, or a route that is not pre-rendered: the page is
	 * rendered, and the slot shows what it would show from the cache. */
	test('fills a slot from the route’s hole, in place of the slot’s own resolver', async () => {
		const ran: Ran = { handler: 0, pageSlot: 0 };
		const path = '/holes/rendered';
		const app = pageFor(ran, path);
		defineHoles(path, {
			cart: () => '<p>the cart</p>',
			greeting: () => '<section>from the route</section>'
		});

		const html = await read(app, path);

		expect(html).toContain('from the route');
		expect(html).toContain('the cart');
		expect(html).not.toContain('page says hello');
		expect(ran.pageSlot).toBe(0);
	});

	test('a slot with no resolver and no hole is said to be one, in the log', async () => {
		const ran: Ran = { handler: 0, pageSlot: 0 };
		const path = '/holes/rendered-undeclared';
		const app = pageFor(ran, path);
		const logged: string[] = [];
		const original = console.log;
		console.log = (...parts: unknown[]) => {
			logged.push(parts.map(String).join(' '));
		};
		try {
			const html = await read(app, path);

			// The slot that has a resolver is unaffected.
			expect(html).toContain('page says hello ada');
			expect(html).not.toContain('the cart');
			// Said once, however often the page is asked for.
			await read(app, path);
		} finally {
			console.log = original;
		}
		const warnings = logged.filter((line) => line.includes('slot "cart"'));
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain('declares no hole "cart"');
	});
});
