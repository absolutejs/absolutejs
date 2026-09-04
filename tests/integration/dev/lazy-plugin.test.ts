import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Elysia, type AnyElysia } from 'elysia';
import { websocket } from 'elysia/websocket';
import { lazyPlugin } from '../../../src/plugins/lazyPlugin';
import { readFixtureEvaluations } from '../../fixtures/lazy-plugin/evaluationCounter';
import { getAvailablePort } from '../../helpers/ports';

/* End to end over a real Bun socket: the plugin module must not be evaluated
 * until a request lands under its prefix, and exactly once after that.
 *
 * `readFixtureEvaluations` lives in a sibling module on purpose — importing
 * the plugin fixture here would evaluate the very thing under test. */

const WS_TIMEOUT_MS = 5_000;

let app: AnyElysia;
let baseUrl: string;
let port: number;
let loadCalls = 0;

const openSocket = (url: string, payload: string) =>
	new Promise<string>((resolve) => {
		const socket = new WebSocket(url);
		const timer = setTimeout(() => {
			socket.close();
			resolve('TIMEOUT');
		}, WS_TIMEOUT_MS);
		const settle = (value: string) => {
			clearTimeout(timer);
			socket.close();
			resolve(value);
		};
		socket.onopen = () => socket.send(payload);
		socket.onmessage = (event) =>
			settle(typeof event.data === 'string' ? event.data : 'BINARY');
		socket.onerror = () => settle('ERROR');
		socket.onclose = (event) => settle(`CLOSED ${event.code}`);
	});

beforeAll(async () => {
	port = await getAvailablePort();
	baseUrl = `http://localhost:${port}`;
	app = new Elysia()
		.use(websocket())
		.get('/', () => 'root')
		.get('/apiary', () => 'bees')
		.use(
			lazyPlugin({
				args: ['lazy'],
				prefix: '/api',
				load: () => {
					loadCalls += 1;

					return import('../../fixtures/lazy-plugin/apiPlugin');
				}
			})
		)
		.listen(port);

	// `.listen()` publishes the handler on a microtask; wait for the socket.
	await Bun.sleep(100);
});

afterAll(async () => {
	await app?.stop(true);
});

describe('dev: a lazyPlugin module is evaluated on first use', () => {
	test('is not evaluated by boot, or by traffic outside the prefix', async () => {
		expect(readFixtureEvaluations()).toBe(0);
		expect(loadCalls).toBe(0);

		expect(await (await fetch(`${baseUrl}/`)).text()).toBe('root');
		// `/apiary` shares the prefix as a string but not as a path segment.
		expect(await (await fetch(`${baseUrl}/apiary`)).text()).toBe('bees');

		expect(readFixtureEvaluations()).toBe(0);
		expect(loadCalls).toBe(0);
	});

	test('the first matching request imports it and answers from it', async () => {
		const response = await fetch(`${baseUrl}/api/hello`);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ hello: 'lazy' });
		expect(readFixtureEvaluations()).toBe(1);
		expect(loadCalls).toBe(1);
	});

	test('a second request does not re-import', async () => {
		const response = await fetch(`${baseUrl}/api/item/7`);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ id: '7' });
		expect(readFixtureEvaluations()).toBe(1);
		expect(loadCalls).toBe(1);
	});

	test('bodies and headers reach the mounted plugin unchanged', async () => {
		const response = await fetch(`${baseUrl}/api/echo`, {
			body: JSON.stringify({ value: 42 }),
			headers: { 'content-type': 'application/json', 'x-probe': 'yes' },
			method: 'POST'
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			echoed: { value: 42 },
			seen: 'yes'
		});
	});

	test('streams and 404s behave as if the plugin had been used eagerly', async () => {
		const streamed = await fetch(`${baseUrl}/api/stream`);
		expect(streamed.status).toBe(200);
		expect(await streamed.text()).toBe('chunk-achunk-b');

		const missing = await fetch(`${baseUrl}/api/missing`);
		expect(missing.status).toBe(404);
	});

	test('a WebSocket route under the prefix still upgrades', async () => {
		expect(
			await openSocket(`ws://localhost:${port}/api/socket`, 'ping')
		).toBe('pong:ping');
	});

	test('the routes the plugin owns are on the app once it is mounted', () => {
		const paths = app.routes.map((route) => route.path);

		expect(paths).toContain('/api/hello');
		expect(paths).toContain('/api/socket');
		expect(readFixtureEvaluations()).toBe(1);
	});
});
