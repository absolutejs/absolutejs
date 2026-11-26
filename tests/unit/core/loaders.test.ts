import { describe, expect, test } from 'bun:test';
import { Elysia, NotFound } from 'elysia';
import type {
	FileRouteContext,
	FileRouteRenderInput
} from '../../../types/fileRoutes';
import { defineFileRouteWith } from '../../../src/core/fileRouteAdapter';
import { fileRoutes } from '../../../src/core/fileRoutes';
import { defineLoader, loadAll, LoaderError } from '../../../src/core/loaders';
import {
	absoluteRequestContext,
	runWithAbsoluteRequest
} from '../../../src/core/requestContext';
import { cookies } from '../../../src/core/requestHelpers';

/* `defineLoader` holds a function to one run per request; `loadAll`
 * waits for several at once. The apps here mount the request-context
 * plugin `prepare()` mounts, because "per request" is that plugin's
 * notion of a request and nothing else's. */

const app = () => new Elysia().use(absoluteRequestContext);

const send = (
	server: { handle: (request: Request) => Promise<Response> },
	path: string,
	init?: RequestInit
) => server.handle(new Request(`http://localhost${path}`, init));

const inRequest = <Result>(run: () => Result) =>
	runWithAbsoluteRequest(new Request('http://localhost/'), run);

/* A loader that counts its runs, which is the thing under test. */
const counted = <Args extends unknown[], Result>(
	load: (...args: Args) => Promise<Result>
) => {
	const calls: Args[] = [];
	const loader = defineLoader(async (...args: Args) => {
		calls.push(args);

		return load(...args);
	});

	return { calls, loader };
};

describe('defineLoader', () => {
	test('runs once however many places in a request call it', async () => {
		const user = counted(async () => ({ name: 'ada' }));
		const helperTwoCallsDown = async () => (await user.loader()).name;
		const server = app()
			.onBeforeHandle(async () => {
				await user.loader();
			})
			.get('/', async () => {
				const [first, second, third] = await Promise.all([
					user.loader(),
					user.loader(),
					helperTwoCallsDown()
				]);

				return { same: first === second, third };
			});

		const response = await send(server, '/');

		expect(await response.json()).toEqual({ same: true, third: 'ada' });
		expect(user.calls).toHaveLength(1);
	});

	test('runs again for the next request', async () => {
		const user = counted(async () => 'ada');
		const server = app().get('/', () => user.loader());

		await send(server, '/');
		await send(server, '/');

		expect(user.calls).toHaveLength(2);
	});

	/* The reason a held value is safe for per-user data: two requests in
	 * flight at once never see each other's. */
	test('two requests in flight each get their own value', async () => {
		const whoAmI = defineLoader(async () => {
			await Bun.sleep(5);

			return cookies().get('user') ?? 'nobody';
		});
		const server = app().get('/', () => whoAmI());

		const [ada, bob] = await Promise.all([
			send(server, '/', { headers: { cookie: 'user=ada' } }),
			send(server, '/', { headers: { cookie: 'user=bob' } })
		]);

		expect(await ada.text()).toBe('ada');
		expect(await bob.text()).toBe('bob');
	});

	test('holds one run per distinct set of arguments', async () => {
		const post = counted(async (slug: string, page: number) => ({
			page,
			slug
		}));

		await inRequest(async () => {
			await post.loader('intro', 1);
			await post.loader('intro', 1);
			await post.loader('intro', 2);
			await post.loader('other', 1);
		});

		expect(post.calls).toEqual([
			['intro', 1],
			['intro', 2],
			['other', 1]
		]);
	});

	test('compares plain objects by content, whatever their key order', async () => {
		const search = counted(
			async (filter: { tag: string; year: number }) => filter.tag
		);

		await inRequest(async () => {
			await search.loader({ tag: 'bun', year: 2026 });
			await search.loader({ tag: 'bun', year: 2026 });
			await search.loader({ tag: 'bun', year: 2025 });
		});

		expect(search.calls).toHaveLength(2);
	});

	/* A wrong match would hand one caller another's data, so values that
	 * only LOOK alike once written down must stay apart. */
	test('never treats different arguments as the same call', async () => {
		const echo = counted(async (...values: unknown[]) => values);
		const lookAlikes: unknown[][] = [
			[1],
			['1'],
			[true],
			['true'],
			[null],
			[undefined],
			['null'],
			[1n],
			[[1, 2]],
			['1,2'],
			[1, 2],
			[[]],
			[{}],
			[],
			[new Date(0)],
			[0],
			['a', 'b'],
			['a,b'],
			['a","b']
		];

		await inRequest(() =>
			Promise.all(lookAlikes.map((values) => echo.loader(...values)))
		);

		expect(echo.calls).toHaveLength(lookAlikes.length);
	});

	/* Identity that is not content: nothing safe to compare, so the call
	 * simply runs. Two `Map`s written as JSON are both `{}`. */
	test('does not hold a call whose argument has no comparable content', async () => {
		const sizeOf = counted(async (value: unknown) => typeof value);
		class Account {
			constructor(readonly id: number) {}
		}

		await inRequest(async () => {
			await sizeOf.loader(new Map([['a', 1]]));
			await sizeOf.loader(new Map([['b', 2]]));
			await sizeOf.loader(new Account(1));
			await sizeOf.loader(new Account(1));
			await sizeOf.loader({ nested: [new Account(1)] });
			await sizeOf.loader({ nested: [new Account(1)] });
		});

		expect(sizeOf.calls).toHaveLength(6);
	});

	test('hands every caller the same failure, without running again', async () => {
		const broken = counted(async () => {
			throw new Error('database is down');
		});

		const messages = await inRequest(async () => {
			const first = await broken.loader().catch((error) => error);
			const second = await broken.loader().catch((error) => error);

			return [first, second];
		});

		expect(messages[0]).toBeInstanceOf(Error);
		expect(messages[1]).toBe(messages[0]);
		expect(broken.calls).toHaveLength(1);
	});

	test('outside a request it is the plain function: every call runs', async () => {
		const build = counted(async () => 'entries');

		expect(await build.loader()).toBe('entries');
		expect(await build.loader()).toBe('entries');
		expect(build.calls).toHaveLength(2);
	});

	/* The case it was built for, through the file router's own hooks: a
	 * guard decides on the user, then `load` reads the same user. */
	test('a file route’s guard and its load share one run', async () => {
		const user = counted(async () => ({ name: 'ada', role: 'admin' }));
		const route = defineFileRouteWith(
			'react',
			{
				guards: [
					async () => ({
						beforeHandle: async () =>
							(await user.loader()).role === 'admin'
								? undefined
								: new Response('no', { status: 403 })
					})
				],
				name: 'RouteAdmin',
				path: '/admin',
				source: 'react/routes/admin.tsx',
				server: async () => ({
					load: async () => loadAll({ user: user.loader() })
				})
			},
			async ({ props }: FileRouteRenderInput) => Response.json(props)
		);
		const server = app().use(fileRoutes([route], {}));

		const response = await send(server, '/admin');

		expect(await response.json()).toEqual({
			user: { name: 'ada', role: 'admin' }
		});
		expect(user.calls).toHaveLength(1);
	});
});

describe('loadAll', () => {
	test('returns each entry under its key, plain values included', async () => {
		const data = await loadAll({
			count: Promise.resolve(3),
			label: 'fixed',
			user: Promise.resolve({ name: 'ada' })
		});

		// typed per key: arithmetic on one, a string method on another
		const total = data.count + 1;
		const shout = data.label.toUpperCase();

		expect(total).toBe(4);
		expect(shout).toBe('FIXED');
		expect(data.user.name).toBe('ada');
	});

	/* Not a clock: the slow entry is still unresolved when the fast one
	 * finishes, which a sequential wait could never show. */
	test('waits for the entries together, not one after another', async () => {
		const order: string[] = [];
		const entry = async (name: string, wait: number) => {
			order.push(`start ${name}`);
			await Bun.sleep(wait);
			order.push(`end ${name}`);

			return name;
		};

		await loadAll({ fast: entry('fast', 1), slow: entry('slow', 15) });

		expect(order).toEqual([
			'start fast',
			'start slow',
			'end fast',
			'end slow'
		]);
	});

	test('rejects with the failed entry’s own error, untouched', async () => {
		const failure = new Error('stats are down');

		const caught = await loadAll({
			stats: Promise.reject(failure),
			user: Promise.resolve('ada')
		}).catch((error) => error);

		expect(caught).toBe(failure);
	});

	test('partial: a failed entry becomes a LoaderError, the rest arrive', async () => {
		const failure = new Error('stats are down');

		const data = await loadAll(
			{ stats: Promise.reject<number>(failure), user: 'ada' },
			{ partial: true }
		);

		expect(data.user).toBe('ada');
		expect(data.stats).toBeInstanceOf(LoaderError);
		if (!(data.stats instanceof LoaderError))
			throw new Error('unreachable');
		expect(data.stats.key).toBe('stats');
		expect(data.stats.cause).toBe(failure);
		expect(data.stats.message).toContain('stats are down');
	});

	/* `partial` is for a source being down. A NotFound or a thrown
	 * Response is the entry ANSWERING — swallowing it would render a
	 * page for something that does not exist. */
	test('partial: a NotFound or a thrown Response is still thrown', async () => {
		const missing = new NotFound();
		const toLogin = new Response(null, {
			headers: { location: '/login' },
			status: 302
		});

		const notFound = await loadAll(
			{ post: Promise.reject(missing), user: 'ada' },
			{ partial: true }
		).catch((error) => error);
		const redirect = await loadAll(
			{ user: Promise.reject(toLogin) },
			{ partial: true }
		).catch((error) => error);

		expect(notFound).toBe(missing);
		expect(redirect).toBe(toLogin);
	});

	test('refuses a loader that was not called', async () => {
		const currentUser = defineLoader(async () => 'ada');
		const entries: Record<string, unknown> = { user: currentUser };

		// @ts-expect-error a function is not an entry: call the loader
		const mistyped = loadAll({ user: currentUser });
		await mistyped.catch(() => undefined);

		await expect(loadAll(entries)).rejects.toThrow(
			'loadAll() was given a function for "user"'
		);
	});

	test('a NotFound thrown by a loader reaches the file router as one', async () => {
		const post = defineLoader(async (slug: string) => {
			if (slug === 'missing') throw new NotFound();

			return { slug };
		});
		const route = defineFileRouteWith(
			'react',
			{
				name: 'RoutePost',
				path: '/post/:slug',
				source: 'react/routes/post/[slug].tsx',
				server: async () => ({
					load: async ({ params }: FileRouteContext<'/post/:slug'>) =>
						loadAll({ post: post(params.slug) })
				})
			},
			async ({ props }: FileRouteRenderInput) => Response.json(props)
		);
		const server = app().use(fileRoutes([route], {}));

		expect((await send(server, '/post/intro')).status).toBe(200);
		expect((await send(server, '/post/missing')).status).toBe(404);
	});
});
