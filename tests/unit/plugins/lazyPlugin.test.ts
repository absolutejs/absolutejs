import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { websocket } from 'elysia/websocket';
import { lazyPlugin } from '../../../src/plugins/lazyPlugin';

/* `lazyPlugin` defers a route-owning plugin's module graph past boot: it
 * registers placeholders for the prefix it owns, then composes the real
 * plugin onto the live app on the first request that lands under it. */

const makeApiPlugin = (tag: string) =>
	new Elysia({ prefix: '/api' })
		.get('/hello', () => ({ hello: tag }))
		.get('/item/:id', ({ params }) => ({ id: params.id }))
		.post('/echo', ({ body, headers }) => ({
			echoed: body,
			seen: headers['x-probe'] ?? null
		}));

const withEnv = async (value: string, run: () => Promise<void>) => {
	const original = process.env.NODE_ENV;
	process.env.NODE_ENV = value;
	try {
		await run();
	} finally {
		if (original === undefined) delete process.env.NODE_ENV;
		else process.env.NODE_ENV = original;
	}
};

describe('lazyPlugin: prefix', () => {
	test('rejects a prefix that cannot scope anything', () => {
		for (const prefix of ['', '/', 'api', '//']) {
			expect(() =>
				lazyPlugin({ prefix, load: () => new Elysia() })
			).toThrow(/must start with "\/"/);
		}
	});

	test('matches the prefix itself and everything under it', async () => {
		let loads = 0;
		const app = new Elysia().use(
			lazyPlugin({
				prefix: '/api',
				load: () => {
					loads += 1;

					return new Elysia({ prefix: '/api' })
						.get('', () => 'index')
						.get('/deep/nested', () => 'deep');
				}
			})
		);

		expect(await (await app.handle('http://x/api')).text()).toBe('index');
		expect(
			await (await app.handle('http://x/api/deep/nested')).text()
		).toBe('deep');
		expect(loads).toBe(1);
	});

	test('does not claim a sibling path that merely shares the prefix string', async () => {
		let loads = 0;
		const app = new Elysia()
			.get('/apiary', () => 'bees')
			.get('/api-docs', () => 'docs')
			.use(
				lazyPlugin({
					prefix: '/api',
					load: () => {
						loads += 1;

						return new Elysia({ prefix: '/api' }).get(
							'/hello',
							() => 'hi'
						);
					}
				})
			);

		expect(await (await app.handle('http://x/apiary')).text()).toBe('bees');
		expect(await (await app.handle('http://x/api-docs')).text()).toBe(
			'docs'
		);
		expect(loads).toBe(0);

		expect(await (await app.handle('http://x/api/hello')).text()).toBe(
			'hi'
		);
		expect(loads).toBe(1);
	});

	test('normalises a trailing slash', async () => {
		const app = new Elysia().use(
			lazyPlugin({
				prefix: '/api/',
				load: () =>
					new Elysia({ prefix: '/api' }).get('/hello', () => 'hi')
			})
		);

		expect(await (await app.handle('http://x/api/hello')).text()).toBe(
			'hi'
		);
	});

	test('answers 404 for a path under the prefix the plugin does not own', async () => {
		const app = new Elysia().use(
			lazyPlugin({
				prefix: '/api',
				load: () =>
					new Elysia({ prefix: '/api' }).get('/hello', () => 'hi')
			})
		);

		expect((await app.handle('http://x/api/hello')).status).toBe(200);
		expect((await app.handle('http://x/api/missing')).status).toBe(404);
		// Also 404 on the very first request, before anything is mounted.
		const fresh = new Elysia().use(
			lazyPlugin({
				prefix: '/api',
				load: () =>
					new Elysia({ prefix: '/api' }).get('/hello', () => 'hi')
			})
		);
		expect((await fresh.handle('http://x/api/missing')).status).toBe(404);
	});
});

describe('lazyPlugin: loading', () => {
	test('shares a single in-flight import across concurrent first requests', async () => {
		let loads = 0;
		const app = new Elysia().use(
			lazyPlugin({
				prefix: '/api',
				load: async () => {
					loads += 1;
					await Bun.sleep(20);

					return new Elysia({ prefix: '/api' }).get(
						'/hello',
						() => 'hi'
					);
				}
			})
		);

		const responses = await Promise.all(
			Array.from({ length: 8 }, () => app.handle('http://x/api/hello'))
		);

		expect(responses.map((response) => response.status)).toEqual(
			Array.from({ length: 8 }, () => 200)
		);
		expect(loads).toBe(1);
	});

	test('does not re-import on later requests', async () => {
		let loads = 0;
		const app = new Elysia().use(
			lazyPlugin({
				prefix: '/api',
				load: () => {
					loads += 1;

					return new Elysia({ prefix: '/api' }).get(
						'/hello',
						() => 'hi'
					);
				}
			})
		);

		await app.handle('http://x/api/hello');
		await app.handle('http://x/api/hello');
		await app.handle('http://x/api/hello');

		expect(loads).toBe(1);
	});

	test('surfaces a load failure as an error instead of hanging', async () => {
		const app = new Elysia().use(
			lazyPlugin({
				prefix: '/api',
				load: () => Promise.reject(new Error('module blew up'))
			})
		);

		const response = await app.handle('http://x/api/hello');

		expect(response.status).toBe(500);
		expect(await response.text()).toContain('module blew up');
	});

	test('retries after a failed load so a fixed module is picked up', async () => {
		let attempts = 0;
		const app = new Elysia().use(
			lazyPlugin({
				prefix: '/api',
				load: () => {
					attempts += 1;
					if (attempts < 3) throw new Error(`broken ${attempts}`);

					return new Elysia({ prefix: '/api' }).get(
						'/hello',
						() => 'fixed'
					);
				}
			})
		);

		expect((await app.handle('http://x/api/hello')).status).toBe(500);
		expect((await app.handle('http://x/api/hello')).status).toBe(500);
		expect(await (await app.handle('http://x/api/hello')).text()).toBe(
			'fixed'
		);
		expect(attempts).toBe(3);
	});
});

describe('lazyPlugin: module shapes', () => {
	const cases: Array<[string, () => unknown, readonly unknown[]]> = [
		[
			'a plugin instance',
			() => new Elysia({ prefix: '/api' }).get('/hello', () => 'hi'),
			[]
		],
		[
			'a default export',
			() => ({
				default: new Elysia({ prefix: '/api' }).get(
					'/hello',
					() => 'hi'
				)
			}),
			[]
		],
		[
			'a namespace with one plugin export',
			() => ({
				apiPlugin: new Elysia({ prefix: '/api' }).get(
					'/hello',
					() => 'hi'
				)
			}),
			[]
		],
		[
			'a factory taking args',
			() => ({
				apiPlugin: (tag: string) =>
					new Elysia({ prefix: '/api' }).get('/hello', () => tag)
			}),
			['hi']
		],
		[
			'an async factory',
			() => ({
				default: async (tag: string) => {
					await Bun.sleep(1);

					return new Elysia({ prefix: '/api' }).get(
						'/hello',
						() => tag
					);
				}
			}),
			['hi']
		]
	];

	for (const [label, load, args] of cases) {
		test(`resolves ${label}`, async () => {
			const app = new Elysia().use(
				lazyPlugin({ args, load, prefix: '/api' })
			);

			expect(await (await app.handle('http://x/api/hello')).text()).toBe(
				'hi'
			);
		});
	}

	test('names the exports when a namespace is ambiguous', async () => {
		const app = new Elysia().use(
			lazyPlugin({
				prefix: '/api',
				load: () => ({
					one: new Elysia({ prefix: '/api' }),
					two: new Elysia({ prefix: '/api' })
				})
			})
		);

		const response = await app.handle('http://x/api/hello');

		expect(response.status).toBe(500);
		const { detail } = await response.json();
		expect(detail).toContain('["one","two"]');
	});
});

describe('lazyPlugin: dispatch', () => {
	test('forwards method, path parameters, body and headers', async () => {
		const app = new Elysia().use(
			lazyPlugin({
				args: ['tagged'],
				prefix: '/api',
				load: () => ({ apiPlugin: makeApiPlugin })
			})
		);

		// The very first request under the prefix is also the one that mounts.
		const echoed = await app.handle(
			new Request('http://x/api/echo', {
				body: JSON.stringify({ value: 42 }),
				headers: {
					'content-type': 'application/json',
					'x-probe': 'yes'
				},
				method: 'POST'
			})
		);

		expect(echoed.status).toBe(200);
		expect(await echoed.json()).toEqual({
			echoed: { value: 42 },
			seen: 'yes'
		});

		const item = await app.handle('http://x/api/item/7');
		expect(await item.json()).toEqual({ id: '7' });

		const hello = await app.handle('http://x/api/hello');
		expect(await hello.json()).toEqual({ hello: 'tagged' });
	});

	test('a prefetch request warms the plugin like any other', async () => {
		let loads = 0;
		const app = new Elysia().use(
			lazyPlugin({
				prefix: '/api',
				load: () => {
					loads += 1;

					return new Elysia({ prefix: '/api' }).get(
						'/hello',
						() => 'hi'
					);
				}
			})
		);

		const warmed = await app.handle(
			new Request('http://x/api/hello', {
				headers: { 'Sec-Purpose': 'prefetch' }
			})
		);

		expect(warmed.status).toBe(200);
		expect(loads).toBe(1);
	});
});

describe('lazyPlugin: composition', () => {
	test('mounts through the real .use(), so the app owns the routes', async () => {
		const app = new Elysia().use(websocket()).use(
			lazyPlugin({
				prefix: '/api',
				load: () =>
					new Elysia({ name: 'api', prefix: '/api' }).get(
						'/hello',
						() => 'hi'
					)
			})
		);

		expect(
			app.routes.some((route) => route.path === '/api/hello')
		).toBeFalse();

		await app.handle('http://x/api/hello');

		expect(
			app.routes.some((route) => route.path === '/api/hello')
		).toBeTrue();
	});

	test('a plugin registered after the lazy one still resolves', async () => {
		const app = new Elysia()
			.use(
				lazyPlugin({
					prefix: '/api',
					load: () =>
						new Elysia({ prefix: '/api' }).get('/hello', () => 'hi')
				})
			)
			.get('/after', () => 'after');

		expect(await (await app.handle('http://x/api/hello')).text()).toBe(
			'hi'
		);
		expect(await (await app.handle('http://x/after')).text()).toBe('after');
		expect(await (await app.handle('http://x/api/hello')).text()).toBe(
			'hi'
		);
	});
});

describe('lazyPlugin: eager fallback', () => {
	test('eager: true composes at .use() time with no placeholder routes', async () => {
		let loads = 0;
		const app = new Elysia().use(
			lazyPlugin({
				eager: true,
				prefix: '/api',
				load: () => {
					loads += 1;

					return new Elysia({ prefix: '/api' }).get(
						'/hello',
						() => 'hi'
					);
				}
			})
		);

		await app.modules;

		expect(loads).toBe(1);
		expect(app.routes.map((route) => route.path)).toEqual(['/api/hello']);
		expect(await (await app.handle('http://x/api/hello')).text()).toBe(
			'hi'
		);
	});

	test('production defaults to eager', async () => {
		await withEnv('production', async () => {
			let loads = 0;
			const app = new Elysia().use(
				lazyPlugin({
					prefix: '/api',
					load: () => {
						loads += 1;

						return new Elysia({ prefix: '/api' }).get(
							'/hello',
							() => 'hi'
						);
					}
				})
			);

			await app.modules;

			expect(loads).toBe(1);
			expect(app.routes.map((route) => route.path)).toEqual([
				'/api/hello'
			]);
		});
	});

	test('development defaults to lazy', async () => {
		await withEnv('development', async () => {
			let loads = 0;
			const app = new Elysia().use(
				lazyPlugin({
					prefix: '/api',
					load: () => {
						loads += 1;

						return new Elysia({ prefix: '/api' }).get(
							'/hello',
							() => 'hi'
						);
					}
				})
			);

			await app.modules;

			expect(loads).toBe(0);
			expect(await (await app.handle('http://x/api/hello')).text()).toBe(
				'hi'
			);
			expect(loads).toBe(1);
		});
	});
});
