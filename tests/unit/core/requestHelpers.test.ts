import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createElement } from 'react';
import { absoluteRequestContext } from '../../../src/core/requestContext';
import { cookies, headers } from '../../../src/core/requestHelpers';
import { handleReactPageRequest } from '../../../src/react/pageHandler';

/* `headers()` and `cookies()` read the request the framework is handling,
 * from wherever they are called. The app here mounts the same
 * request-context plugin `prepare()` does, so the cookies a route queues
 * leave on a real response. */

/* Not a route handler: the point of the helpers is that this needs no
 * request passed to it. */
const localeThreeCallsDown = () => headers().get('accept-language') ?? 'none';
const themeThreeCallsDown = () => cookies().get('theme') ?? 'none';

const app = () => new Elysia().use(absoluteRequestContext);

const send = (
	server: { handle: (request: Request) => Promise<Response> },
	path: string,
	init?: RequestInit
) => server.handle(new Request(`http://localhost${path}`, init));

describe('headers()', () => {
	test('reads the request from a function that was not handed it', async () => {
		const server = app().get('/', () => localeThreeCallsDown());
		const response = await send(server, '/', {
			headers: { 'accept-language': 'fr-CA' }
		});

		expect(await response.text()).toBe('fr-CA');
	});

	test('two requests in flight each read their own', async () => {
		const server = app().get('/', async () => {
			await Bun.sleep(5);

			return localeThreeCallsDown();
		});
		const [first, second] = await Promise.all([
			send(server, '/', { headers: { 'accept-language': 'de' } }),
			send(server, '/', { headers: { 'accept-language': 'ja' } })
		]);

		expect(await first.text()).toBe('de');
		expect(await second.text()).toBe('ja');
	});

	test('outside a request, says so', () => {
		expect(() => headers()).toThrow(
			/headers\(\) was called outside a request/
		);
		expect(() => cookies()).toThrow(
			/cookies\(\) was called outside a request/
		);
	});
});

describe('cookies() reading', () => {
	test('get, has and getAll, decoded, the first of a repeated name', async () => {
		const server = app().get('/', () => ({
			all: cookies().getAll(),
			hasOther: cookies().has('other'),
			hasTheme: cookies().has('theme'),
			theme: themeThreeCallsDown()
		}));
		const response = await send(server, '/', {
			headers: {
				cookie: 'theme=dark; name=Ada%20L; quoted="q v"; theme=light; bare'
			}
		});

		expect(await response.json()).toEqual({
			all: { name: 'Ada L', quoted: 'q v', theme: 'dark' },
			hasOther: false,
			hasTheme: true,
			theme: 'dark'
		});
	});

	test('a request with no cookies has none', async () => {
		const server = app().get('/', () => cookies().getAll());

		expect(await (await send(server, '/')).json()).toEqual({});
	});
});

describe('cookies() writing', () => {
	test('a set cookie leaves on the response, with safe defaults', async () => {
		const server = app().get('/', () => {
			cookies().set('theme', 'dark mode');

			return 'ok';
		});
		const response = await send(server, '/');

		expect(response.headers.getSetCookie()).toEqual([
			'theme=dark%20mode; Path=/; HttpOnly; SameSite=Lax'
		]);
	});

	test('Secure follows the request: on behind an HTTPS proxy', async () => {
		const server = app().get('/', () => {
			cookies().set('theme', 'dark');

			return 'ok';
		});
		const response = await send(server, '/', {
			headers: { 'x-forwarded-proto': 'https' }
		});

		expect(response.headers.getSetCookie()).toEqual([
			'theme=dark; Path=/; HttpOnly; Secure; SameSite=Lax'
		]);
	});

	test('every option is written', async () => {
		const server = app().get('/', () => {
			cookies().set('pref', 'v', {
				domain: 'example.com',
				httpOnly: false,
				maxAge: 3600.9,
				partitioned: true,
				path: '/app',
				sameSite: 'none',
				secure: true
			});
			cookies().set('until', 'v', {
				expires: new Date('2030-01-02T03:04:05Z'),
				sameSite: 'strict'
			});

			return 'ok';
		});
		const response = await send(server, '/');

		expect(response.headers.getSetCookie()).toEqual([
			'pref=v; Path=/app; Domain=example.com; Max-Age=3600; Secure; SameSite=None; Partitioned',
			'until=v; Path=/; Expires=Wed, 02 Jan 2030 03:04:05 GMT; HttpOnly; SameSite=Strict'
		]);
	});

	test('setting a name twice sends the last; another path is another cookie', async () => {
		const server = app().get('/', () => {
			cookies().set('step', '1');
			cookies().set('step', '2');
			cookies().set('step', 'admin', { path: '/admin' });

			return 'ok';
		});
		const response = await send(server, '/');

		expect(response.headers.getSetCookie()).toEqual([
			'step=2; Path=/; HttpOnly; SameSite=Lax',
			'step=admin; Path=/admin; HttpOnly; SameSite=Lax'
		]);
	});

	test('delete expires the cookie, both ways a browser understands', async () => {
		const server = app().get('/', () => {
			cookies().delete('promo');

			return 'ok';
		});
		const response = await send(server, '/');

		expect(response.headers.getSetCookie()).toEqual([
			'promo=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT'
		]);
	});

	test('a read later in the same request sees the write', async () => {
		const server = app().get('/', () => {
			const before = cookies().get('theme');
			cookies().set('theme', 'dark');
			const afterSet = cookies().get('theme');
			cookies().delete('promo');

			return {
				afterSet,
				before,
				promo: cookies().has('promo'),
				remaining: cookies().getAll()
			};
		});
		const response = await send(server, '/', {
			headers: { cookie: 'theme=light; promo=1' }
		});

		expect(await response.json()).toEqual({
			afterSet: 'dark',
			before: 'light',
			promo: false,
			remaining: { theme: 'dark' }
		});
	});
});

describe('cookies() on every kind of response', () => {
	const server = app()
		.get('/response', () => {
			cookies().set('a', '1');

			return new Response('r', { headers: { 'set-cookie': 'own=1' } });
		})
		.get('/redirect', ({ redirect }) => {
			cookies().set('a', '1');

			return redirect('/elsewhere');
		})
		.get('/json', () => {
			cookies().set('a', '1');

			return { ok: true };
		})
		.get('/elysia', ({ cookie }) => {
			cookies().set('a', '1');
			cookie.own?.set({ path: '/', value: 'x' });

			return 'ok';
		});
	const QUEUED = 'a=1; Path=/; HttpOnly; SameSite=Lax';

	test('a returned Response keeps its own cookie and gains the queued one', async () => {
		expect(
			(await send(server, '/response')).headers.getSetCookie()
		).toEqual(['own=1', QUEUED]);
	});

	test('a redirect carries it', async () => {
		const response = await send(server, '/redirect');

		expect(response.status).toBe(302);
		expect(response.headers.getSetCookie()).toEqual([QUEUED]);
	});

	test('a JSON body carries it', async () => {
		expect((await send(server, '/json')).headers.getSetCookie()).toEqual([
			QUEUED
		]);
	});

	test("the route's own Elysia cookie is kept beside it", async () => {
		const sent = (await send(server, '/elysia')).headers.getSetCookie();

		expect(sent).toContain(QUEUED);
		expect(sent.some((cookie) => cookie.startsWith('own=x'))).toBe(true);
	});
});

describe('cookies() when the route does not answer normally', () => {
	const server = app()
		.onBeforeHandle(({ path }) => {
			if (path !== '/guarded') return undefined;
			cookies().set('seen', 'guard');

			return new Response('sign in', { status: 401 });
		})
		.get('/guarded', () => 'never reached')
		.get('/refused', ({ status }) => {
			cookies().set('seen', 'refused');

			return status(403, 'no');
		})
		.get('/throws', () => {
			cookies().set('seen', 'before the throw');
			throw new Error('the handler failed');
		});

	test.each([
		['/guarded', 401, 'seen=guard; Path=/; HttpOnly; SameSite=Lax'],
		['/refused', 403, 'seen=refused; Path=/; HttpOnly; SameSite=Lax'],
		[
			'/throws',
			500,
			'seen=before%20the%20throw; Path=/; HttpOnly; SameSite=Lax'
		]
	])('%s still sends what was set', async (path, status, cookie) => {
		const consoleError = console.error;
		console.error = () => {};
		try {
			const response = await send(server, path);

			expect(response.status).toBe(status);
			expect(response.headers.getSetCookie()).toEqual([cookie]);
		} finally {
			console.error = consoleError;
		}
	});
});

describe('a cookie that cannot be sent', () => {
	test.each([
		['a name with a space', () => cookies().set('bad name', 'v')],
		['a name with "="', () => cookies().set('a=b', 'v')],
		['an empty name', () => cookies().set('', 'v')],
		[
			'a path that would end the attribute',
			() => cookies().set('a', 'v', { path: '/x; Domain=evil.example' })
		],
		[
			'sameSite none without secure',
			() => cookies().set('a', 'v', { sameSite: 'none' })
		],
		[
			'a maxAge that is not a number',
			() => cookies().set('a', 'v', { maxAge: Number.NaN })
		]
	])('%s is refused where it is set', async (_label, attempt) => {
		const server = app().get('/', () => {
			try {
				attempt();

				return 'accepted';
			} catch (error) {
				return `refused: ${error instanceof Error ? error.constructor.name : 'unknown'}`;
			}
		});
		const response = await send(server, '/');

		expect(await response.text()).toBe('refused: TypeError');
		expect(response.headers.getSetCookie()).toEqual([]);
	});

	/* The headers of a streamed response are sent before its body has
	 * finished being produced. A cookie set from inside the stream has
	 * no header left to travel in, and saying nothing would lose it. */
	test('one set after the response has started throws', async () => {
		let late = 'not attempted';
		const server = app().get('/', () => {
			cookies().set('early', '1');

			return new Response(
				new ReadableStream({
					pull(controller) {
						try {
							cookies().set('late', '1');
							late = 'accepted';
						} catch (error) {
							late =
								error instanceof Error
									? error.message
									: 'unknown';
						}
						controller.enqueue(new TextEncoder().encode('body'));
						controller.close();
					}
				})
			);
		});
		const response = await send(server, '/');
		await response.text();

		expect(response.headers.getSetCookie()).toEqual([
			'early=1; Path=/; HttpOnly; SameSite=Lax'
		]);
		expect(late).toContain(
			'The cookie "late" was set after the response had started.'
		);
	});
});

describe('during a server render', () => {
	/* A component rendering on the server is as far from the route
	 * handler as code gets. It reads the same request, and a cookie it
	 * sets while the shell renders still makes the response. */
	test('a React page reads and sets cookies as it renders', async () => {
		const Page = () => {
			const visits = Number(cookies().get('visits') ?? '0') + 1;
			cookies().set('visits', String(visits));

			return createElement(
				'html',
				null,
				createElement(
					'body',
					null,
					createElement('p', { id: 'visits' }, `visit ${visits}`)
				)
			);
		};
		const server = app().get('/', ({ request }) =>
			handleReactPageRequest({
				index: '/PageIndex.js',
				Page,
				request
			})
		);
		const response = await send(server, '/', {
			headers: { cookie: 'visits=4' }
		});

		expect(await response.text()).toContain('visit 5');
		expect(response.headers.getSetCookie()).toEqual([
			'visits=5; Path=/; HttpOnly; SameSite=Lax'
		]);
	});
});
