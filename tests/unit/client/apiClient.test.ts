import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia, t } from 'elysia';
import { createApiClient } from '../../../src/client/apiClient';

/* The typed API client against a real Elysia app: the calls below are
 * checked by the compiler against the app's routes, and sent through the
 * app's own `handle`, so what is asserted is what a route actually
 * receives and answers.
 *
 * The lines marked `@ts-expect-error` are half the test. They are calls
 * the types must refuse, and `absolute typecheck` fails if one of them
 * ever compiles. */

type Todo = { done: boolean; id: string; title: string };

const todos = new Map<string, Todo>();

const server = new Elysia()
	.get('/', () => 'home')
	.get('/health', () => ({ ok: true }))
	.get(
		'/todos',
		{
			query: t.Object({
				done: t.Optional(t.String()),
				tag: t.Optional(t.Array(t.String()))
			})
		},
		({ query }) => ({
			done: query.done ?? null,
			tags: query.tag ?? []
		})
	)
	.get(
		'/todos/:id',
		{
			response: {
				200: t.Object({
					done: t.Boolean(),
					id: t.String(),
					title: t.String()
				}),
				404: t.Object({ missing: t.String() })
			}
		},
		({ params, status }) => {
			const todo = todos.get(params.id);

			return todo ?? status(404, { missing: params.id });
		}
	)
	.post(
		'/todos',
		{ body: t.Object({ title: t.String({ minLength: 2 }) }) },
		({ body, headers }) => {
			const todo: Todo = { done: false, id: 'new', title: body.title };
			todos.set(todo.id, todo);

			return { echo: headers['x-trace'] ?? null, todo };
		}
	)
	.put(
		'/todos/:id',
		{ body: t.Object({ title: t.String() }) },
		({ body, params }) => ({ id: params.id, title: body.title })
	)
	.patch('/todos/:id/done', ({ params }) => ({ done: params.id }))
	.delete('/todos/:id', ({ params, set }) => {
		todos.delete(params.id);
		set.status = 204;
	})
	.get('/files/*', ({ params }) => ({ rest: params['*'] }))
	.group('/api/v1', (app) => app.get('/ping', () => ({ pong: true })))
	.use(new Elysia({ prefix: '/admin' }).get('/stats', () => ({ users: 3 })))
	.get('/plain', () => new Response('just text'))
	.post('/upload', async ({ request }) => {
		const text = await request.text();

		return {
			hasName: text.includes('photo.png'),
			kind: request.headers.get('content-type')?.split(';')[0]
		};
	});

const api = createApiClient<typeof server>({
	baseUrl: 'http://localhost',
	fetch: (input, init) => server.handle(new Request(input, init))
});

const NAVIGATION_RUNTIME = Symbol.for('absolutejs.navigation');
const originalWindow: unknown = Reflect.get(globalThis, 'window');

afterEach(() => {
	todos.clear();
	Reflect.deleteProperty(globalThis, NAVIGATION_RUNTIME);
	if (originalWindow === undefined)
		Reflect.deleteProperty(globalThis, 'window');
	else Reflect.set(globalThis, 'window', originalWindow);
});

describe('a call', () => {
	test('reaches the route and returns what it answered, typed', async () => {
		const { data, error, status } = await api.get('/health');

		expect(error).toBeNull();
		expect(status).toBe(200);
		// `data` is `{ ok: boolean } | null` until `error` is ruled out.
		if (error !== null) throw new Error('unreachable');
		const { ok } = data;
		expect(ok).toBe(true);
	});

	test('serves the root path', async () => {
		const { data } = await api.get('/');

		expect(data).toBe('home');
	});

	test('fills a path param, encoded', async () => {
		todos.set('a/b', { done: true, id: 'a/b', title: 'slashed' });

		const { data } = await api.get('/todos/:id', {
			params: { id: 'a/b' }
		});

		expect(data?.title).toBe('slashed');
	});

	test('hands a wildcard the rest of the path, slashes intact', async () => {
		const { data } = await api.get('/files/*', {
			params: { '*': 'docs/guide/intro.md' }
		});

		expect(data).toEqual({ rest: 'docs/guide/intro.md' });
	});

	test('sends the query, an array as a repeated key, and skips undefined', async () => {
		const { data } = await api.get('/todos', {
			query: { done: undefined, tag: ['home', 'work'] }
		});

		expect(data).toEqual({ done: null, tags: ['home', 'work'] });
	});

	test('sends a body as JSON, with the call’s headers', async () => {
		const { data } = await api.post('/todos', {
			body: { title: 'Ship it' },
			headers: { 'x-trace': 'abc' }
		});

		expect(data).toEqual({
			echo: 'abc',
			todo: { done: false, id: 'new', title: 'Ship it' }
		});
	});

	test('sends a FormData body as it is', async () => {
		const body = new FormData();
		body.set('name', 'photo.png');

		const { data } = await api.post('/upload', { body });

		// The browser's own multipart encoding, not JSON of a FormData.
		expect(data).toEqual({ hasName: true, kind: 'multipart/form-data' });
	});

	test('put, patch and delete reach their routes', async () => {
		const put = await api.put('/todos/:id', {
			body: { title: 'renamed' },
			params: { id: '7' }
		});
		const patch = await api.patch('/todos/:id/done', {
			params: { id: '7' }
		});
		const removed = await api.delete('/todos/:id', {
			params: { id: '7' }
		});

		expect(put.data).toEqual({ id: '7', title: 'renamed' });
		expect(patch.data).toEqual({ done: '7' });
		// 204: a success with nothing in it.
		expect(removed.error).toBeNull();
		expect(removed.status).toBe(204);
		expect(removed.data).toBeUndefined();
	});

	/* Routes that reach the app through a group or a mounted plugin are
	 * in its type under their full path, like any other. */
	test('reaches a route registered in a group or a prefixed plugin', async () => {
		const ping = await api.get('/api/v1/ping');
		const stats = await api.get('/admin/stats');

		expect(ping.data?.pong).toBe(true);
		expect(stats.data?.users).toBe(3);
	});

	test('reads a text answer as text', async () => {
		const { data } = await api.get('/plain');

		expect(data).toBe('just text');
	});
});

describe('a call that fails', () => {
	test('resolves with the route’s declared error, typed by status', async () => {
		const { data, error, status } = await api.get('/todos/:id', {
			params: { id: 'nope' }
		});

		expect(data).toBeNull();
		expect(status).toBe(404);
		if (error === null) throw new Error('unreachable');
		// Narrowing on the status the route declared types the value.
		if (error.status !== 404) throw new Error('unreachable');
		expect(error.value).toEqual({ missing: 'nope' });
	});

	test('resolves with a validation failure rather than throwing', async () => {
		const { error, status } = await api.post('/todos', {
			body: { title: 'x' }
		});

		expect(status).toBe(422);
		expect(error).not.toBeNull();
	});

	test('reports a request that got no answer as status 0', async () => {
		const offline = createApiClient<typeof server>({
			baseUrl: 'http://localhost',
			fetch: () => Promise.reject(new TypeError('fetch failed'))
		});

		const { data, error, response, status } = await offline.get('/health');

		expect(data).toBeNull();
		expect(status).toBe(0);
		expect(response).toBeUndefined();
		expect(error?.status).toBe(0);
		expect(error?.value).toBeInstanceOf(TypeError);
	});

	test('rejects when the caller aborts it', async () => {
		const controller = new AbortController();
		const slow = createApiClient<typeof server>({
			baseUrl: 'http://localhost',
			fetch: (_input, init) =>
				new Promise((_resolve, reject) => {
					init.signal?.addEventListener('abort', () =>
						reject(new DOMException('aborted', 'AbortError'))
					);
				})
		});

		const pending = slow.get('/health', { signal: controller.signal });
		controller.abort();

		await expect(pending).rejects.toThrow('aborted');
	});

	test('refuses a call without the param its path needs', async () => {
		const untyped: Record<string, string> = {};

		await expect(
			// @ts-expect-error `id` is required by the path
			api.get('/todos/:id', { params: untyped })
		).rejects.toThrow('needs params.id');
	});
});

describe('what the types refuse', () => {
	/* Never called: these only have to fail to compile. */
	const neverRun = () => [
		// @ts-expect-error no such route
		api.get('/nope'),
		// @ts-expect-error `/todos/:id` has no POST
		api.post('/todos/:id', { params: { id: '1' } }),
		// @ts-expect-error the path's param is required
		api.get('/todos/:id'),
		// @ts-expect-error the route's body is required
		api.post('/todos'),
		// @ts-expect-error `title` is a string
		api.post('/todos', { body: { title: 5 } }),
		// @ts-expect-error `page` is not in the route's query
		api.get('/todos', { query: { page: '2' } })
	];

	test('is checked by the compiler, not at run time', () => {
		expect(typeof neverRun).toBe('function');
	});
});

describe('client options', () => {
	test('headers for every call, asked per call when a function', async () => {
		let asked = 0;
		const traced = createApiClient<typeof server>({
			baseUrl: 'http://localhost',
			fetch: (input, init) => server.handle(new Request(input, init)),
			headers: () => {
				asked += 1;

				return { 'x-trace': `call-${asked}` };
			}
		});

		const first = await traced.post('/todos', { body: { title: 'one' } });
		const second = await traced.post('/todos', { body: { title: 'two' } });

		expect(first.data?.echo).toBe('call-1');
		expect(second.data?.echo).toBe('call-2');
	});
});

type Seen = { refreshes: number };

describe('invalidate: true', () => {
	const watchRefreshes = () => {
		const seen: Seen = { refreshes: 0 };
		// A framework page with no way to take new props, so the
		// refresh goes to the navigation layer being watched here.
		Reflect.set(globalThis, 'window', {
			__ABSOLUTE_PAGE_READY__: Promise.resolve(),
			location: { reload: () => {} }
		});
		Reflect.set(globalThis, NAVIGATION_RUNTIME, {
			disable: () => undefined,
			navigate: () => Promise.resolve('swapped'),
			refresh: () => {
				seen.refreshes += 1;

				return Promise.resolve('swapped');
			}
		});

		return seen;
	};

	test('refreshes the page after a call that succeeded', async () => {
		const seen = watchRefreshes();

		const result = await api.post('/todos', {
			body: { title: 'Ship it' },
			invalidate: true
		});
		// The caller has the result before the page is touched.
		expect(result.error).toBeNull();
		expect(seen.refreshes).toBe(0);
		await Bun.sleep(5);

		expect(seen.refreshes).toBe(1);
	});

	test('leaves the page alone after a call that failed', async () => {
		const seen = watchRefreshes();

		await api.post('/todos', { body: { title: 'x' }, invalidate: true });
		await Bun.sleep(5);

		expect(seen.refreshes).toBe(0);
	});

	test('is off unless asked for', async () => {
		const seen = watchRefreshes();

		await api.post('/todos', { body: { title: 'Ship it' } });
		await Bun.sleep(5);

		expect(seen.refreshes).toBe(0);
	});
});
