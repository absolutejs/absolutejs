import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { Elysia } from 'elysia';
import { compressResponses } from '../../../src/plugins/compressResponses';

/* Compressing what the app's own routes return, opt-in. */

const ITEMS = Array.from({ length: 80 }, (_, id) => ({
	id,
	name: `item number ${id}`
}));
const TEXT = 'plain text line.\n'.repeat(120);

const originalEnv = process.env.NODE_ENV;
afterEach(() => {
	process.env.NODE_ENV = originalEnv;
});

const appWith = () =>
	new Elysia()
		.use(compressResponses())
		.get('/json', ({ cookie, set }) => {
			set.status = 201;
			set.headers['x-route'] = 'kept';
			const { session } = cookie;
			if (session) session.value = 'abc';

			return ITEMS;
		})
		.get('/small', () => ({ ok: true }))
		.get('/text', () => TEXT)
		.get('/html', ({ set }) => {
			set.headers['content-type'] = 'text/html; charset=utf-8';

			return `<p>${TEXT}</p>`;
		})
		.get('/own-response', () => Response.json(ITEMS))
		.get(
			'/events',
			() =>
				new Response(`data: ${TEXT}\n\n`, {
					headers: { 'content-type': 'text/event-stream' }
				})
		)
		.get('/generator', function* () {
			yield 'first ';
			yield TEXT;
		})
		.get(
			'/encoded',
			() =>
				new Response(TEXT, {
					headers: {
						'content-encoding': 'identity',
						'content-type': 'text/plain'
					}
				})
		)
		.get('/no-transform', ({ set }) => {
			set.headers['cache-control'] = 'no-transform';

			return ITEMS;
		})
		.get(
			'/binary',
			() =>
				new Response(new Uint8Array(4096), {
					headers: { 'content-type': 'application/octet-stream' }
				})
		);

const ask = (
	app: { handle: (request: Request) => Promise<Response> },
	path: string,
	headers: Record<string, string> = { 'accept-encoding': 'br, gzip' },
	method = 'GET'
) => app.handle(new Request(`http://localhost${path}`, { headers, method }));

const bytesOf = async (response: Response) =>
	Buffer.from(await response.arrayBuffer());

describe('a value a route returns', () => {
	test('JSON is compressed, keeping the route’s status, headers and cookies', async () => {
		const response = await ask(appWith(), '/json');

		expect(response.status).toBe(201);
		expect(response.headers.get('content-encoding')).toBe('br');
		expect(response.headers.get('content-type')).toBe('application/json');
		expect(response.headers.get('vary')).toContain('Accept-Encoding');
		expect(response.headers.get('x-route')).toBe('kept');
		expect(response.headers.get('set-cookie')).toContain('session=abc');
		expect(
			JSON.parse(brotliDecompressSync(await bytesOf(response)).toString())
		).toEqual(ITEMS);
	});

	test('text is compressed, gzip when brotli is not accepted', async () => {
		const response = await ask(appWith(), '/text', {
			'accept-encoding': 'gzip'
		});

		expect(response.headers.get('content-encoding')).toBe('gzip');
		expect(gunzipSync(await bytesOf(response)).toString()).toBe(TEXT);
	});

	test('a small one is sent as it is, as Elysia would', async () => {
		const response = await ask(appWith(), '/small');

		expect(response.headers.get('content-encoding')).toBeNull();
		expect(await response.json()).toEqual({ ok: true });
	});
});

describe('a Response a route returns', () => {
	test('with a compressible type is compressed as it streams', async () => {
		const response = await ask(appWith(), '/own-response');

		expect(response.headers.get('content-encoding')).toBe('br');
		expect(response.headers.get('content-length')).toBeNull();
		expect(
			JSON.parse(brotliDecompressSync(await bytesOf(response)).toString())
		).toEqual(ITEMS);
	});
});

describe('what is never compressed', () => {
	test('an event stream, and a generator’s stream, which arrive whole', async () => {
		const events = await ask(appWith(), '/events');
		const generator = await ask(appWith(), '/generator');

		expect(events.headers.get('content-encoding')).toBeNull();
		expect(await events.text()).toContain('plain text line.');
		expect(generator.headers.get('content-encoding')).toBeNull();
		expect(await generator.text()).toContain('first plain text line.');
	});

	test('a page, a body already encoded, one marked no-transform, and binary data', async () => {
		const app = appWith();
		for (const path of ['/html', '/encoded', '/no-transform', '/binary']) {
			const response = await ask(app, path);

			expect(
				response.headers.get('content-encoding') ?? 'none'
			).not.toMatch(/br|gzip/);
		}
	});

	test('a HEAD request, a range request, and a client that accepts no encoding', async () => {
		const app = appWith();
		const head = await ask(
			app,
			'/json',
			{ 'accept-encoding': 'br' },
			'HEAD'
		);
		const range = await ask(app, '/json', {
			'accept-encoding': 'br',
			range: 'bytes=0-10'
		});
		const identity = await ask(app, '/json', {
			'accept-encoding': 'identity'
		});

		for (const response of [head, range, identity])
			expect(response.headers.get('content-encoding')).toBeNull();
	});
});

/* Elysia's rules, which decide where the plugin goes. */
describe('where it is mounted', () => {
	const big = () => ITEMS;

	test('reaches the routes, groups and plugins after it, and not those before', async () => {
		const app = new Elysia()
			.get('/before', big)
			.use(compressResponses())
			.get('/after', big)
			.use(new Elysia().get('/plugin', big))
			.group('/api', (group) => group.get('/grouped', big));
		const encodings = await Promise.all(
			['/before', '/after', '/plugin', '/api/grouped'].map(async (path) =>
				(await ask(app, path)).headers.get('content-encoding')
			)
		);

		expect(encodings).toEqual([null, 'br', 'br', 'br']);
	});

	test('inside a group, covers that group alone', async () => {
		const app = new Elysia()
			.group('/api', (group) =>
				group.use(compressResponses()).get('/items', big)
			)
			.get('/other', big);

		expect(
			(await ask(app, '/api/items')).headers.get('content-encoding')
		).toBe('br');
		expect(
			(await ask(app, '/other')).headers.get('content-encoding')
		).toBeNull();
	});

	test('the app’s own response hooks run when mounted before it', async () => {
		const ran: string[] = [];
		const app = new Elysia()
			.mapResponse(() => {
				ran.push('app hook');
			})
			.use(compressResponses())
			.get('/items', big);
		const response = await ask(app, '/items');

		expect(response.headers.get('content-encoding')).toBe('br');
		expect(ran).toEqual(['app hook']);
	});

	test('says, in development, which of the app’s routes it was mounted after', () => {
		process.env.NODE_ENV = 'development';
		const spy = spyOn(console, 'log').mockImplementation(() => undefined);
		new Elysia()
			.get('/api/items', big)
			.get('/__absolute/ready', () => 'ok')
			.get('/assets/logo.png', () => 'png')
			.use(compressResponses());
		const said = spy.mock.calls.map((call) => String(call[0])).join('\n');
		spy.mockRestore();

		expect(said).toContain('GET /api/items');
		expect(said).not.toContain('/__absolute/ready');
		expect(said).not.toContain('logo.png');
	});

	test('says nothing when mounted first, or in production', () => {
		const spy = spyOn(console, 'log').mockImplementation(() => undefined);
		process.env.NODE_ENV = 'development';
		new Elysia().use(compressResponses()).get('/a', big);
		process.env.NODE_ENV = 'production';
		new Elysia().get('/b', big).use(compressResponses());
		const calls = spy.mock.calls.length;
		spy.mockRestore();

		expect(calls).toBe(0);
	});
});
