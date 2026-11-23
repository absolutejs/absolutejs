import { Elysia } from 'elysia';
import { afterEach, describe, expect, test } from 'bun:test';
import {
	clearHealthChecks,
	registerHealthCheck
} from '../../../src/core/healthChecks';
import { health } from '../../../src/plugins/health';
import type { HealthConfig } from '../../../types/health';

/* The endpoints an orchestrator probes.
 *
 * Liveness and readiness are separate answers on purpose. A failing
 * liveness probe gets the process killed, so it must not depend on a
 * database: that would restart a healthy server every time its database
 * hiccuped. A failing readiness probe takes the process out of rotation,
 * which is the right answer when a dependency it needs is unusable. */

afterEach(() => {
	clearHealthChecks();
});

const appWith = (config?: boolean | HealthConfig) =>
	new Elysia().use(health(config)).get('/', () => 'page');

const get = async (app: ReturnType<typeof appWith>, path: string) => {
	const response = await app.handle(new Request(`http://app.test${path}`));
	const text = await response.text();
	/* The app's own route answers text, so only JSON is parsed. */
	const isJson = (response.headers.get('content-type') ?? '').includes(
		'json'
	);

	return {
		body: isJson ? JSON.parse(text) : text,
		cacheControl: response.headers.get('cache-control'),
		status: response.status
	};
};

describe('the endpoints', () => {
	test('are on by default at the documented paths', async () => {
		const app = appWith();

		expect(await get(app, '/__absolute/live')).toMatchObject({
			body: { status: 'ok' },
			status: 200
		});
		expect(await get(app, '/__absolute/ready')).toMatchObject({
			body: { status: 'ok' },
			status: 200
		});
	});

	/* A cached 200 from a readiness probe is a readiness probe that has
	 * stopped working, and a proxy with a default policy will cache a GET
	 * returning JSON. */
	test('are never cacheable', async () => {
		const app = appWith();

		expect((await get(app, '/__absolute/live')).cacheControl).toBe(
			'no-store'
		);
		expect((await get(app, '/__absolute/ready')).cacheControl).toBe(
			'no-store'
		);
	});

	test('can be renamed', async () => {
		const app = appWith({ liveness: '/healthz', readiness: '/readyz' });

		expect((await get(app, '/healthz')).status).toBe(200);
		expect((await get(app, '/readyz')).status).toBe(200);
		expect((await get(app, '/__absolute/live')).status).toBe(404);
	});

	test('health: false removes them', async () => {
		const app = appWith(false);

		expect((await get(app, '/__absolute/live')).status).toBe(404);
		expect((await get(app, '/__absolute/ready')).status).toBe(404);
		/* And the app itself still works. */
		expect((await get(app, '/')).status).toBe(200);
	});
});

describe('readiness', () => {
	test('answers 503 when a check fails', async () => {
		registerHealthCheck('database', () => false);
		const result = await get(appWith(), '/__absolute/ready');

		expect(result.status).toBe(503);
		expect(result.body).toEqual({ status: 'unready' });
	});

	/* The distinction the two paths exist for: a dead dependency must not
	 * get the process restarted. */
	test('a failing check does not affect liveness', async () => {
		registerHealthCheck('database', () => {
			throw new Error('ECONNREFUSED');
		});

		expect((await get(appWith(), '/__absolute/live')).status).toBe(200);
		expect((await get(appWith(), '/__absolute/ready')).status).toBe(503);
	});

	/* Default off: these endpoints are reachable by anyone who can reach
	 * the app, and the names of your dependencies are information you may
	 * not want to publish. */
	test('details are withheld unless asked for', async () => {
		registerHealthCheck('internal-billing-db', () => false);

		expect((await get(appWith(), '/__absolute/ready')).body).toEqual({
			status: 'unready'
		});

		const detailed = await get(
			appWith({ details: true }),
			'/__absolute/ready'
		);

		expect(detailed.status).toBe(503);
		expect(detailed.body.checks).toHaveLength(1);
		expect(detailed.body.checks[0]).toMatchObject({
			error: 'returned false',
			name: 'internal-billing-db',
			ok: false
		});
	});

	test('a check that hangs answers rather than hanging', async () => {
		registerHealthCheck('wedged', () => new Promise<void>(() => undefined));
		const result = await get(
			appWith({ details: true, timeoutMs: 50 }),
			'/__absolute/ready'
		);

		expect(result.status).toBe(503);
		expect(result.body.checks[0]?.error).toBe('timed out');
	});
});
