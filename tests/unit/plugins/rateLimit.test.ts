import { Elysia } from 'elysia';
import { describe, expect, test } from 'bun:test';
import { rateLimit } from '../../../src/plugins/rateLimit';
import type { RateLimitConfig } from '../../../types/rateLimit';

/* The plugin against a real app.
 *
 * `app.handle()` has no socket, so `server.requestIP` yields nothing and
 * every request here shares the `unknown` key — which is the right shape
 * for these tests anyway: they are about which paths are limited, what the
 * response says, and what is deliberately left alone. Keying is tested
 * against `clientKeyFor` in `rateLimit.test.ts`, where a connection
 * address can be supplied directly. */

const appWith = (config: RateLimitConfig | undefined, vitalsPath?: string) =>
	new Elysia()
		.use(
			rateLimit({
				config,
				/* What `prepare()` passes: the resolved health paths. */
				exemptPaths: ['/__absolute/live', '/__absolute/ready'],
				vitalsPath
			})
		)
		.get('/', () => 'page')
		.get('/api/items', () => 'items')
		.get('/api/upload', () => 'upload')
		.get('/__absolute/ready', () => '{"status":"ok"}')
		.post('/__absolute/vitals', () => 'ok');

const get = (app: ReturnType<typeof appWith>, path: string) =>
	app.handle(new Request(`http://app.test${path}`));

const post = (app: ReturnType<typeof appWith>, path: string) =>
	app.handle(new Request(`http://app.test${path}`, { method: 'POST' }));

describe('what is limited', () => {
	/* A framework that starts refusing a project's traffic on its own, at
	 * a number it picked, is worse than one that does nothing. */
	test('nothing, by default', async () => {
		const app = appWith(undefined);
		for (let index = 0; index < 50; index += 1)
			// eslint-disable-next-line no-await-in-loop -- sequential on purpose
			expect((await get(app, '/')).status).toBe(200);
	});

	test('a configured path, and only that path', async () => {
		const app = appWith({ rules: [{ limit: 2, path: '/api' }] });

		expect((await get(app, '/api/items')).status).toBe(200);
		expect((await get(app, '/api/items')).status).toBe(200);
		expect((await get(app, '/api/items')).status).toBe(429);
		/* A path no rule covers is untouched. */
		expect((await get(app, '/')).status).toBe(200);
	});

	/* So a stricter rule is not masked by a looser prefix. */
	test('the longest matching prefix wins', async () => {
		const app = appWith({
			rules: [
				{ limit: 10, path: '/api' },
				{ limit: 1, path: '/api/upload' }
			]
		});

		expect((await get(app, '/api/upload')).status).toBe(200);
		expect((await get(app, '/api/upload')).status).toBe(429);
		/* The looser rule still has its own allowance. */
		expect((await get(app, '/api/items')).status).toBe(200);
	});

	test('a global limit covers everything else', async () => {
		const app = appWith({ limit: 1, rules: [{ limit: 5, path: '/api' }] });

		expect((await get(app, '/')).status).toBe(200);
		expect((await get(app, '/')).status).toBe(429);
		/* The rule's own allowance is separate from the global one. */
		expect((await get(app, '/api/items')).status).toBe(200);
	});
});

describe('the framework’s own endpoints', () => {
	/* An unauthenticated POST sink the framework mounts on the app's
	 * behalf: leaving it open is the framework's omission, not the app's
	 * choice. */
	test('the vitals endpoint is limited by default', async () => {
		const app = appWith(undefined, '/__absolute/vitals');
		const statuses: number[] = [];
		for (let index = 0; index < 62; index += 1)
			// eslint-disable-next-line no-await-in-loop -- the order is the test
			statuses.push((await post(app, '/__absolute/vitals')).status);

		expect(statuses.slice(0, 60).every((status) => status === 200)).toBe(
			true
		);
		expect(statuses[60]).toBe(429);
	});

	/* The one that must never be limited. A 429 to a readiness probe is a
	 * failed probe, and a failed readiness probe takes the process out of
	 * rotation — so a limit here turns a burst of probes into an outage.
	 * The amplification is handled by caching the report instead.
	 *
	 * This test caught the first version doing exactly that: a global
	 * `limit` covers every path no rule names, so setting one limited
	 * readiness too. */
	test('health is not limited, even with a global limit', async () => {
		const app = appWith({ limit: 1 }, '/__absolute/vitals');

		expect((await get(app, '/')).status).toBe(200);
		expect((await get(app, '/')).status).toBe(429);

		for (let index = 0; index < 20; index += 1)
			// eslint-disable-next-line no-await-in-loop -- sequential on purpose
			expect((await get(app, '/__absolute/ready')).status).toBe(200);
	});

	/* A project that means to limit its own probes may: the exemption is
	 * from the global fallback, not from a rule that names the path. */
	test('an explicit rule can still limit a health path', async () => {
		const app = appWith({
			rules: [{ limit: 1, path: '/__absolute/ready' }]
		});

		expect((await get(app, '/__absolute/ready')).status).toBe(200);
		expect((await get(app, '/__absolute/ready')).status).toBe(429);
	});

	/* An app that says something about that path keeps what it said. */
	test('an explicit rule for the vitals path replaces the default', async () => {
		const app = appWith(
			{ rules: [{ limit: 1, path: '/__absolute/vitals' }] },
			'/__absolute/vitals'
		);

		expect((await post(app, '/__absolute/vitals')).status).toBe(200);
		expect((await post(app, '/__absolute/vitals')).status).toBe(429);
	});
});

describe('what a refusal tells the client', () => {
	test('Retry-After and the RateLimit headers', async () => {
		const app = appWith({ rules: [{ limit: 1, path: '/api' }] });
		const allowed = await get(app, '/api/items');

		expect(allowed.headers.get('RateLimit-Limit')).toBe('1');
		expect(allowed.headers.get('RateLimit-Remaining')).toBe('0');
		/* Nothing to retry while the request is being served. */
		expect(allowed.headers.get('Retry-After')).toBeNull();

		const refused = await get(app, '/api/items');

		expect(refused.status).toBe(429);
		expect(refused.headers.get('Retry-After')).toBe('60');
		expect(refused.headers.get('RateLimit-Remaining')).toBe('0');
	});

	/* The point of refusing in `onRequest` is that the work never happens;
	 * a 429 whose body is the page would have rendered the page. */
	test('a refused request never reaches the handler', async () => {
		let handled = 0;
		const app = new Elysia()
			.use(rateLimit({ config: { limit: 1 } }))
			.get('/', () => {
				handled += 1;

				return 'page';
			});

		await app.handle(new Request('http://app.test/'));
		const refused = await app.handle(new Request('http://app.test/'));

		expect(refused.status).toBe(429);
		expect(await refused.text()).toBe('Too Many Requests');
		expect(handled).toBe(1);
	});
});
