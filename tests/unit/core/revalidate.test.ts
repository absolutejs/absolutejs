import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test
} from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
	RevalidateAllResult,
	RevalidationOutcome
} from '../../../types/revalidate';
import { removePrerendered, rerenderRoute } from '../../../src/core/prerender';
import {
	createRevalidationQueue,
	createStaticRouteMatcher,
	registerRevalidator,
	revalidateAll,
	revalidatePath,
	revalidateTag
} from '../../../src/core/revalidate';

/* On-demand revalidation in three layers: the queue that decides which
 * render a caller gets, the two public functions on top of whatever
 * `prepare()` registered, and the re-render itself replacing a page's
 * files. The whole path under `absolute start` is the integration
 * test's (tests/integration/server/revalidate-path.test.ts). */

type Deferred = { promise: Promise<boolean>; resolve: (ok: boolean) => void };

const deferred = () => {
	let finish: (ok: boolean) => void = () => undefined;
	const promise = new Promise<boolean>((resolve) => {
		finish = resolve;
	});
	const made: Deferred = { promise, resolve: (ok) => finish(ok) };

	return made;
};

/* A renderer the test finishes by hand, so "while a render is under
 * way" is a state the test is in rather than a race it hopes to win. */
const manualRenderer = () => {
	const started: Deferred[] = [];
	const render = () => {
		const next = deferred();
		started.push(next);

		return next.promise;
	};

	return { render, started };
};

const tick = () => Bun.sleep(0);

describe('the revalidation queue', () => {
	test('renders a route that is idle, once', async () => {
		const { render, started } = manualRenderer();
		const queue = createRevalidationQueue(render, false);

		const done = queue.revalidate('/blog');
		expect(queue.isBusy('/blog')).toBe(true);
		started[0]?.resolve(true);

		expect(await done).toBe(true);
		expect(started).toHaveLength(1);
		expect(queue.isBusy('/blog')).toBe(false);
	});

	/* The point of the queue. The render under way started before this
	 * caller's change and may have read the old data: being told it
	 * "succeeded" would be a lie about the page. */
	test('a caller during a render gets the NEXT render, not that one', async () => {
		const { render, started } = manualRenderer();
		const queue = createRevalidationQueue(render, false);
		const settled: string[] = [];

		void queue.revalidate('/blog').then(() => settled.push('first'));
		void queue.revalidate('/blog').then(() => settled.push('second'));
		started[0]?.resolve(true);
		await tick();

		// The first render finished; the late caller is still waiting,
		// and a second render has begun for it.
		expect(settled).toEqual(['first']);
		expect(started).toHaveLength(2);

		started[1]?.resolve(true);
		await tick();
		expect(settled).toEqual(['first', 'second']);
	});

	test('a burst during one render shares a single following render', async () => {
		const { render, started } = manualRenderer();
		const queue = createRevalidationQueue(render, false);

		void queue.revalidate('/blog');
		const burst = [
			queue.revalidate('/blog'),
			queue.revalidate('/blog'),
			queue.revalidate('/blog')
		];
		started[0]?.resolve(true);
		await tick();
		started[1]?.resolve(true);

		expect(await Promise.all(burst)).toEqual([true, true, true]);
		expect(started).toHaveLength(2);
	});

	test('routes do not wait for each other', async () => {
		const { render, started } = manualRenderer();
		const queue = createRevalidationQueue(render, false);

		void queue.revalidate('/blog');
		void queue.revalidate('/about');

		expect(started).toHaveLength(2);
	});

	test('a render that fails, or throws, is false and frees the route', async () => {
		const failing = createRevalidationQueue(
			() => Promise.resolve(false),
			false
		);
		const throwing = createRevalidationQueue<boolean>(
			() => Promise.reject(new Error('render exploded')),
			false
		);

		expect(await failing.revalidate('/blog')).toBe(false);
		expect(await throwing.revalidate('/blog')).toBe(false);
		expect(throwing.isBusy('/blog')).toBe(false);
	});
});

describe('revalidatePath and revalidateAll', () => {
	const rendered: string[] = [];
	type Registered = {
		creatable?: string[];
		outcomes?: Record<string, RevalidationOutcome>;
		routes: string[];
		tagged?: Record<string, string[]>;
	};
	const register = ({
		creatable = [],
		outcomes = {},
		routes,
		tagged = {}
	}: Registered) =>
		registerRevalidator({
			canCreate: (route) => creatable.includes(route),
			revalidate: (route) => {
				rendered.push(route);

				return Promise.resolve(outcomes[route] ?? 'replaced');
			},
			routes: () => routes,
			routesTagged: (tags) => [
				...new Set(tags.flatMap((tag) => tagged[tag] ?? []))
			]
		});

	afterEach(() => {
		rendered.length = 0;
		registerRevalidator(undefined);
	});

	test('re-renders a pre-rendered route', async () => {
		register({ routes: ['/', '/blog'] });

		expect(await revalidatePath('/blog')).toBe(true);
		expect(rendered).toEqual(['/blog']);
	});

	test('reads a trailing slash, a query and a full URL as the route', async () => {
		register({ routes: ['/', '/blog'] });

		await revalidatePath('/blog/');
		await revalidatePath('/blog?page=2#top');
		await revalidatePath('https://example.com/blog');
		await revalidatePath('/');

		expect(rendered).toEqual(['/blog', '/blog', '/blog', '/']);
	});

	test('is false, and renders nothing, for a path static.routes does not cover', async () => {
		register({ routes: ['/blog'] });

		expect(await revalidatePath('/dashboard')).toBe(false);
		expect(rendered).toEqual([]);
	});

	/* A post published after the build: not pre-rendered, but its path
	 * is one the config covers, so asking creates its page. */
	test('renders a path that is not pre-rendered yet when the config covers it', async () => {
		register({ creatable: ['/blog/new-post'], routes: ['/blog/old'] });

		expect(await revalidatePath('/blog/new-post')).toBe(true);
		expect(rendered).toEqual(['/blog/new-post']);
	});

	/* A deleted post: the page being taken down IS the cache made
	 * current, so it is a success, not a failure. */
	test('is true when the page was removed because it is no longer one', async () => {
		register({
			outcomes: { '/blog/gone': 'removed' },
			routes: ['/blog/gone']
		});

		expect(await revalidatePath('/blog/gone')).toBe(true);
	});

	test('is false when the render fails', async () => {
		register({ outcomes: { '/blog': 'failed' }, routes: ['/blog'] });

		expect(await revalidatePath('/blog')).toBe(false);
	});

	/* Dev, or an app with no `static` config: nothing to refresh, and
	 * a route handler that calls this must not start throwing there. */
	test('does nothing where no page is pre-rendered', async () => {
		expect(await revalidatePath('/blog')).toBe(false);
		expect(await revalidateAll()).toEqual({
			failed: [],
			removed: [],
			revalidated: []
		});
	});

	test('revalidateAll re-renders every route and sorts them by what happened', async () => {
		register({
			outcomes: { '/about': 'failed', '/old': 'removed' },
			routes: ['/', '/blog', '/about', '/old']
		});

		expect(await revalidateAll()).toEqual({
			failed: ['/about'],
			removed: ['/old'],
			revalidated: ['/', '/blog']
		});
		expect(rendered).toEqual(['/', '/blog', '/about', '/old']);
	});
});

describe('revalidateTag', () => {
	const rendered: string[] = [];
	const register = (
		tagged: Record<string, string[]>,
		failing: string[] = []
	) =>
		registerRevalidator({
			canCreate: () => false,
			revalidate: (route) => {
				rendered.push(route);

				return Promise.resolve(
					failing.includes(route) ? 'failed' : 'replaced'
				);
			},
			routes: () => ['/', '/blog', '/blog/hello', '/about'],
			routesTagged: (tags) => [
				...new Set(tags.flatMap((tag) => tagged[tag] ?? []))
			]
		});

	afterEach(() => {
		rendered.length = 0;
		registerRevalidator(undefined);
	});

	test('re-renders the pages carrying the tag, and only those', async () => {
		register({ posts: ['/', '/blog', '/blog/hello'] });

		expect(await revalidateTag('posts')).toEqual({
			failed: [],
			removed: [],
			revalidated: ['/', '/blog', '/blog/hello']
		});
		expect(rendered).not.toContain('/about');
	});

	test('several tags re-render a page carrying more than one of them once', async () => {
		register({
			'post:hello': ['/blog/hello'],
			posts: ['/blog', '/blog/hello']
		});

		await revalidateTag('posts', 'post:hello');

		expect(rendered).toEqual(['/blog', '/blog/hello']);
	});

	test('says which of its pages failed', async () => {
		register({ posts: ['/blog', '/blog/hello'] }, ['/blog']);

		expect(await revalidateTag('posts')).toEqual({
			failed: ['/blog'],
			removed: [],
			revalidated: ['/blog/hello']
		});
	});

	/* A change to data no pre-rendered page shows has nothing to
	 * refresh. That is the common case in dev and must not be an error. */
	test('a tag no page carries, or no pre-rendering at all, is three empty lists', async () => {
		register({});
		const none: RevalidateAllResult = {
			failed: [],
			removed: [],
			revalidated: []
		};

		expect(await revalidateTag('unused')).toEqual(none);
		registerRevalidator(undefined);
		expect(await revalidateTag('posts')).toEqual(none);
		expect(rendered).toEqual([]);
	});
});

describe('which paths may be given a page they do not have yet', () => {
	test('none, when nothing is configured as static', () => {
		expect(createStaticRouteMatcher(undefined)('/blog/a')).toBe(false);
	});

	test('any, under routes: all', () => {
		expect(createStaticRouteMatcher('all')('/anything/at/all')).toBe(true);
	});

	test('a listed path, and nothing beside it', () => {
		const covers = createStaticRouteMatcher(['/', '/about']);

		expect(covers('/about')).toBe(true);
		expect(covers('/')).toBe(true);
		expect(covers('/about/team')).toBe(false);
		expect(covers('/abou')).toBe(false);
	});

	test('a pattern covers one segment per param', () => {
		const covers = createStaticRouteMatcher(['/blog/:slug']);

		expect(covers('/blog/new-post')).toBe(true);
		expect(covers('/blog')).toBe(false);
		expect(covers('/blog/2026/new-post')).toBe(false);
		expect(covers('/blogs/new-post')).toBe(false);
	});

	test('an optional param covers the path with it and without', () => {
		const covers = createStaticRouteMatcher(['/shop/:category?']);

		expect(covers('/shop')).toBe(true);
		expect(covers('/shop/hats')).toBe(true);
		expect(covers('/shop/hats/red')).toBe(false);
	});

	/* `/docs/*` is the folder: what the same pattern pre-renders at
	 * build time is the folder's index and everything below it, so that
	 * is what may be created later. */
	test('a folder covers its own path and everything below it', () => {
		const covers = createStaticRouteMatcher(['/docs/*']);

		expect(covers('/docs/guide/routing')).toBe(true);
		expect(covers('/docs/intro')).toBe(true);
		expect(covers('/docs')).toBe(true);
		expect(covers('/docsite')).toBe(false);
		expect(covers('/other')).toBe(false);
	});

	test('`/*` covers every path', () => {
		const covers = createStaticRouteMatcher(['/*']);

		expect(covers('/')).toBe(true);
		expect(covers('/anything/below')).toBe(true);
	});

	/* A literal segment is text, not a pattern: a `.` in it must not
	 * match any character. */
	test('reads the rest of a path literally', () => {
		const covers = createStaticRouteMatcher(['/v1.0/:page']);

		expect(covers('/v1.0/intro')).toBe(true);
		expect(covers('/v1x0/intro')).toBe(false);
	});
});

const page = (body: string) =>
	`<!DOCTYPE html><html><head><title>t</title></head><body>${body}</body></html>`;

describe('a re-render replacing a page’s files', () => {
	let root = '';
	let prerenderDir = '';
	let server: ReturnType<typeof Bun.serve> | undefined;
	const answers = new Map<string, () => Response>();

	beforeAll(async () => {
		root = await mkdtemp(join(tmpdir(), 'absolute-revalidate-'));
		prerenderDir = join(root, '_prerendered');
		await mkdir(join(prerenderDir, 'docs'), { recursive: true });
		server = Bun.serve({
			port: 0,
			fetch: (request) => {
				const answer = answers.get(new URL(request.url).pathname);

				return answer?.() ?? new Response('missing', { status: 404 });
			}
		});
	});

	afterAll(async () => {
		await server?.stop(true);
		await rm(root, { force: true, recursive: true });
	});

	afterEach(() => answers.clear());

	const html = (body: string, headers: Record<string, string> = {}) =>
		new Response(page(body), {
			headers: { 'content-type': 'text/html', ...headers }
		});
	const port = () => server?.port ?? 0;
	const live = (name: string) => join(prerenderDir, name);

	test('puts the new page, and its sidecars, in place of the old', async () => {
		await writeFile(live('blog.html'), page('OLD'));
		await writeFile(live('blog.meta'), '1');
		answers.set('/blog', () =>
			html('NEW', {
				'content-security-policy': "script-src 'nonce-abc123'",
				'x-absolute-partial-holes': 'slot-a'
			})
		);

		expect(await rerenderRoute('/blog', port(), prerenderDir)).toBe(
			'replaced'
		);

		expect(await readFile(live('blog.html'), 'utf-8')).toBe(page('NEW'));
		expect(await readFile(live('blog.nonce'), 'utf-8')).toBe('abc123');
		expect((await readFile(live('blog.holes'), 'utf-8')).trim()).toBe(
			'slot-a'
		);
		expect(
			Number(await readFile(live('blog.meta'), 'utf-8'))
		).toBeGreaterThan(1);
	});

	test('keeps the tags the render declared, and drops them when it declares none', async () => {
		await writeFile(live('tagged.html'), page('OLD'));
		answers.set('/tagged', () =>
			html('NEW', { 'x-absolute-cache-tags': 'posts,post%3Ahello' })
		);

		await rerenderRoute('/tagged', port(), prerenderDir);
		expect(await readFile(live('tagged.tags'), 'utf-8')).toBe(
			'posts\npost:hello\n'
		);

		answers.set('/tagged', () => html('NEWER'));
		await rerenderRoute('/tagged', port(), prerenderDir);
		expect(existsSync(live('tagged.tags'))).toBe(false);
	});

	/* A page that had holes and a nonce and is rendered without them
	 * must not keep the previous render's: the shell would be served
	 * with holes that are no longer in it. */
	test('drops a sidecar the new render did not produce', async () => {
		await writeFile(live('about.html'), page('OLD'));
		await writeFile(live('about.holes'), 'slot-a\n');
		await writeFile(live('about.nonce'), 'stale');
		answers.set('/about', () => html('NEW'));

		expect(await rerenderRoute('/about', port(), prerenderDir)).toBe(
			'replaced'
		);

		expect(existsSync(live('about.holes'))).toBe(false);
		expect(existsSync(live('about.nonce'))).toBe(false);
		expect(await readFile(live('about.html'), 'utf-8')).toBe(page('NEW'));
	});

	test('replaces a nested route’s page', async () => {
		await writeFile(live('docs/guide.html'), page('OLD'));
		answers.set('/docs/guide', () => html('NEW'));

		expect(await rerenderRoute('/docs/guide', port(), prerenderDir)).toBe(
			'replaced'
		);

		expect(await readFile(live('docs/guide.html'), 'utf-8')).toBe(
			page('NEW')
		);
	});

	test('leaves the old page when the render fails', async () => {
		await writeFile(live('down.html'), page('OLD'));
		answers.set('/down', () => new Response('boom', { status: 500 }));
		await writeFile(live('cut.html'), page('OLD'));
		// A document that stops before `</html>`: a render cut short.
		answers.set(
			'/cut',
			() =>
				new Response('<!DOCTYPE html><html><body>half', {
					headers: { 'content-type': 'text/html' }
				})
		);

		expect(await rerenderRoute('/down', port(), prerenderDir)).toBe(
			'failed'
		);
		expect(await rerenderRoute('/cut', port(), prerenderDir)).toBe(
			'failed'
		);

		expect(await readFile(live('down.html'), 'utf-8')).toBe(page('OLD'));
		expect(await readFile(live('cut.html'), 'utf-8')).toBe(page('OLD'));
	});

	/* The app saying "this is not a page any more" is different from
	 * the app failing to say anything. The first must not leave the old
	 * copy up; the second must. */
	test('reports a 404, a 410, a redirect or a non-HTML answer as gone', async () => {
		answers.set('/missing', () => new Response('nope', { status: 404 }));
		answers.set('/retired', () => new Response('', { status: 410 }));
		answers.set(
			'/moved',
			() =>
				new Response(null, { headers: { location: '/' }, status: 302 })
		);
		answers.set('/members', () => new Response('', { status: 401 }));
		answers.set('/data', () => Response.json({ not: 'a page' }));

		const outcomes = await Promise.all(
			['/missing', '/retired', '/moved', '/members', '/data'].map(
				(route) => rerenderRoute(route, port(), prerenderDir)
			)
		);

		expect(outcomes).toEqual(['gone', 'gone', 'gone', 'gone', 'gone']);
	});

	/* "Try again later" is not an answer about the page. */
	test('treats a server error, a timeout and a rate limit as a failure', async () => {
		answers.set('/boom', () => new Response('', { status: 500 }));
		answers.set('/slow', () => new Response('', { status: 408 }));
		answers.set('/busy', () => new Response('', { status: 429 }));
		answers.set('/early', () => new Response('', { status: 425 }));
		answers.set('/gateway', () => new Response('', { status: 502 }));

		const outcomes = await Promise.all(
			['/boom', '/slow', '/busy', '/early', '/gateway'].map((route) =>
				rerenderRoute(route, port(), prerenderDir)
			)
		);

		expect(new Set(outcomes)).toEqual(new Set(['failed']));
	});

	/* A re-render that finds the page gone decides; it does not delete.
	 * The server stops serving the route first, then removes the files. */
	test('a gone page’s files stay until they are removed, then all go', async () => {
		await writeFile(live('old.html'), page('OLD'));
		await writeFile(live('old.meta'), '1');
		await writeFile(live('old.nonce'), 'abc');
		await writeFile(live('old.holes'), 'slot-a\n');
		answers.set('/old', () => new Response('nope', { status: 404 }));

		expect(await rerenderRoute('/old', port(), prerenderDir)).toBe('gone');
		expect(existsSync(live('old.html'))).toBe(true);

		removePrerendered(prerenderDir, '/old');

		expect(
			['old.html', 'old.meta', 'old.nonce', 'old.holes'].filter((name) =>
				existsSync(live(name))
			)
		).toEqual([]);
	});

	test('creates the page for a route that had none', async () => {
		answers.set('/blog/new-post', () => html('FRESH'));

		expect(
			await rerenderRoute('/blog/new-post', port(), prerenderDir)
		).toBe('replaced');

		expect(await readFile(live('blog/new-post.html'), 'utf-8')).toBe(
			page('FRESH')
		);
	});

	/* Everything in the pre-render directory is read as a page when the
	 * server starts, so nothing may be staged — or left — inside it. */
	test('stages outside the pre-render directory and leaves nothing behind', async () => {
		answers.set('/blog', () => html('AGAIN'));

		await rerenderRoute('/blog', port(), prerenderDir);

		const inside = readdirSync(prerenderDir, { recursive: true }).map(
			String
		);
		expect(inside.filter((name) => name.includes('staging'))).toEqual([]);
		expect(inside.filter((name) => name.includes('tmp'))).toEqual([]);
		expect(readdirSync(join(root, '.prerender-staging'))).toEqual([]);
	});
});
