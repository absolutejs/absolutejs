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

const appWith = (
	config: RateLimitConfig | undefined,
	vitalsPath?: string,
	vitalsSummaryPath?: string
) =>
	new Elysia()
		.use(
			rateLimit({
				config,
				/* What `prepare()` passes: the resolved health paths. */
				exemptPaths: ['/__absolute/live', '/__absolute/ready'],
				vitalsPath,
				vitalsSummaryPath
			})
		)
		.get('/', () => 'page')
		.get('/api/items', () => 'items')
		.get('/api/upload', () => 'upload')
		.get('/__absolute/ready', () => '{"status":"ok"}')
		.get('/__absolute/vitals/summary', () => '{"routes":[]}')
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

	/* The summary path sits UNDER the batch endpoint's path, so without a
	 * rule of its own longest-prefix matching hands it the batch rule —
	 * and an overlay polling the numbers once a second would exhaust the
	 * 60/min meant for page loads AND share a bucket with them, so reading
	 * the summary would start refusing the reports that fill it. */
	test('polling the summary does not spend the batch endpoint’s allowance', async () => {
		const app = appWith(
			undefined,
			'/__absolute/vitals',
			'/__absolute/vitals/summary'
		);
		for (let index = 0; index < 100; index += 1)
			// eslint-disable-next-line no-await-in-loop -- the order is the test
			expect((await get(app, '/__absolute/vitals/summary')).status).toBe(
				200
			);

		/* The batch endpoint still has its full allowance. */
		const batch = await post(app, '/__absolute/vitals');

		expect(batch.status).toBe(200);
		expect(batch.headers.get('RateLimit-Remaining')).toBe('59');
	});

	/* It is still bounded: a cheap read is not a free one. */
	test('the summary has a ceiling of its own', async () => {
		const app = appWith(
			undefined,
			'/__absolute/vitals',
			'/__absolute/vitals/summary'
		);
		const statuses: number[] = [];
		for (let index = 0; index < 602; index += 1)
			// eslint-disable-next-line no-await-in-loop -- the order is the test
			statuses.push(
				(await get(app, '/__absolute/vitals/summary')).status
			);

		expect(statuses[599]).toBe(200);
		expect(statuses[600]).toBe(429);
	});

	/* An app that says something about that path keeps what it said. */
	test('an explicit rule for the summary path replaces the default', async () => {
		const app = appWith(
			{ rules: [{ limit: 1, path: '/__absolute/vitals/summary' }] },
			'/__absolute/vitals',
			'/__absolute/vitals/summary'
		);

		expect((await get(app, '/__absolute/vitals/summary')).status).toBe(200);
		expect((await get(app, '/__absolute/vitals/summary')).status).toBe(429);
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

/* A deployment that says it is behind a proxy says so once, at the top
 * level, and the limiter follows — unless it is told otherwise itself. */
describe('the top-level trustProxy setting', () => {
	const from = (app: ReturnType<typeof appWith>, client: string) =>
		app.handle(
			new Request('http://app.test/', {
				headers: { 'x-forwarded-for': client }
			})
		);

	const withDeploymentTrust = async (run: () => Promise<void>) => {
		const previous = process.env.ABSOLUTE_TRUST_PROXY;
		process.env.ABSOLUTE_TRUST_PROXY = '1';
		try {
			await run();
		} finally {
			if (previous === undefined) delete process.env.ABSOLUTE_TRUST_PROXY;
			else process.env.ABSOLUTE_TRUST_PROXY = previous;
		}
	};

	test('is what the limiter uses when it has no setting of its own', async () => {
		await withDeploymentTrust(async () => {
			const app = appWith({ limit: 1 });

			expect((await from(app, '203.0.113.1')).status).toBe(200);
			expect((await from(app, '203.0.113.1')).status).toBe(429);
			/* A different client has its own allowance. */
			expect((await from(app, '203.0.113.2')).status).toBe(200);
		});
	});

	test('is overridden by rateLimit.trustProxy: false', async () => {
		await withDeploymentTrust(async () => {
			const app = appWith({ limit: 1, trustProxy: false });

			expect((await from(app, '203.0.113.1')).status).toBe(200);
			/* The header is not believed, so both share one key. */
			expect((await from(app, '203.0.113.2')).status).toBe(429);
		});
	});

	test('off by default: a forwarded address is not believed', async () => {
		const app = appWith({ limit: 1 });

		expect((await from(app, '203.0.113.1')).status).toBe(200);
		expect((await from(app, '203.0.113.2')).status).toBe(429);
	});
});
