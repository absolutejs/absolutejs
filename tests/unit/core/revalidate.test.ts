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
import { rerenderRoute } from '../../../src/core/prerender';
import {
	createRevalidationQueue,
	registerRevalidator,
	revalidateAll,
	revalidatePath
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
		const queue = createRevalidationQueue(render);

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
		const queue = createRevalidationQueue(render);
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
		const queue = createRevalidationQueue(render);

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
		const queue = createRevalidationQueue(render);

		void queue.revalidate('/blog');
		void queue.revalidate('/about');

		expect(started).toHaveLength(2);
	});

	test('a render that fails, or throws, is false and frees the route', async () => {
		const failing = createRevalidationQueue(() => Promise.resolve(false));
		const throwing = createRevalidationQueue(() =>
			Promise.reject(new Error('render exploded'))
		);

		expect(await failing.revalidate('/blog')).toBe(false);
		expect(await throwing.revalidate('/blog')).toBe(false);
		expect(throwing.isBusy('/blog')).toBe(false);
	});
});

describe('revalidatePath and revalidateAll', () => {
	const rendered: string[] = [];
	const register = (routes: string[], failing: string[] = []) =>
		registerRevalidator({
			revalidate: (route) => {
				rendered.push(route);

				return Promise.resolve(!failing.includes(route));
			},
			routes: () => routes
		});

	afterEach(() => {
		rendered.length = 0;
		registerRevalidator(undefined);
	});

	test('re-renders a pre-rendered route', async () => {
		register(['/', '/blog']);

		expect(await revalidatePath('/blog')).toBe(true);
		expect(rendered).toEqual(['/blog']);
	});

	test('reads a trailing slash, a query and a full URL as the route', async () => {
		register(['/', '/blog']);

		await revalidatePath('/blog/');
		await revalidatePath('/blog?page=2#top');
		await revalidatePath('https://example.com/blog');
		await revalidatePath('/');

		expect(rendered).toEqual(['/blog', '/blog', '/blog', '/']);
	});

	test('is false, and renders nothing, for a route that is not pre-rendered', async () => {
		register(['/blog']);

		expect(await revalidatePath('/dashboard')).toBe(false);
		expect(rendered).toEqual([]);
	});

	test('is false when the render fails', async () => {
		register(['/blog'], ['/blog']);

		expect(await revalidatePath('/blog')).toBe(false);
	});

	/* Dev, or an app with no `static` config: nothing to refresh, and
	 * a route handler that calls this must not start throwing there. */
	test('does nothing where no page is pre-rendered', async () => {
		expect(await revalidatePath('/blog')).toBe(false);
		expect(await revalidateAll()).toEqual({ failed: [], revalidated: [] });
	});

	test('revalidateAll re-renders every route and says which failed', async () => {
		register(['/', '/blog', '/about'], ['/about']);

		expect(await revalidateAll()).toEqual({
			failed: ['/about'],
			revalidated: ['/', '/blog']
		});
		expect(rendered).toEqual(['/', '/blog', '/about']);
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

		expect(await rerenderRoute('/blog', port(), prerenderDir)).toBe(true);

		expect(await readFile(live('blog.html'), 'utf-8')).toBe(page('NEW'));
		expect(await readFile(live('blog.nonce'), 'utf-8')).toBe('abc123');
		expect((await readFile(live('blog.holes'), 'utf-8')).trim()).toBe(
			'slot-a'
		);
		expect(
			Number(await readFile(live('blog.meta'), 'utf-8'))
		).toBeGreaterThan(1);
	});

	/* A page that had holes and a nonce and is rendered without them
	 * must not keep the previous render's: the shell would be served
	 * with holes that are no longer in it. */
	test('drops a sidecar the new render did not produce', async () => {
		await writeFile(live('about.html'), page('OLD'));
		await writeFile(live('about.holes'), 'slot-a\n');
		await writeFile(live('about.nonce'), 'stale');
		answers.set('/about', () => html('NEW'));

		expect(await rerenderRoute('/about', port(), prerenderDir)).toBe(true);

		expect(existsSync(live('about.holes'))).toBe(false);
		expect(existsSync(live('about.nonce'))).toBe(false);
		expect(await readFile(live('about.html'), 'utf-8')).toBe(page('NEW'));
	});

	test('replaces a nested route’s page', async () => {
		await writeFile(live('docs/guide.html'), page('OLD'));
		answers.set('/docs/guide', () => html('NEW'));

		expect(await rerenderRoute('/docs/guide', port(), prerenderDir)).toBe(
			true
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

		expect(await rerenderRoute('/down', port(), prerenderDir)).toBe(false);
		expect(await rerenderRoute('/cut', port(), prerenderDir)).toBe(false);

		expect(await readFile(live('down.html'), 'utf-8')).toBe(page('OLD'));
		expect(await readFile(live('cut.html'), 'utf-8')).toBe(page('OLD'));
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
