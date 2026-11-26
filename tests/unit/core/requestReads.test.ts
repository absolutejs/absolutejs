import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Elysia } from 'elysia';
import {
	cacheTagEmitter,
	decodeCacheTags,
	REQUEST_READS_HEADER
} from '../../../src/core/cacheTags';
import {
	formatPrerenderWarning,
	prerender,
	PRERENDER_BYPASS_HEADER,
	PRERENDER_BYPASS_TOKEN,
	rerenderRoute
} from '../../../src/core/prerender';
import { absoluteRequestContext } from '../../../src/core/requestContext';
import { cookies, headers } from '../../../src/core/requestHelpers';

/* A pre-rendered page that reads the request.
 *
 * The page is rendered once, for a request the pre-renderer made, and
 * that copy is served to everyone. A read of `cookies()` or `headers()`
 * on the way is therefore a mistake that nothing else catches: it works
 * on the developer's machine and is wrong for every visitor. These pin
 * that the read is noticed during a pre-render, reported to the
 * pre-renderer — and that a visitor's request is left exactly as it
 * was. */

const SHELL_HEADER = 'X-Absolute-Partial-Shell';

const page = (body: string) =>
	new Response(
		`<!DOCTYPE html><html><head><title>t</title></head><body>${body}</body></html>`,
		{ headers: { 'content-type': 'text/html' } }
	);

const app = new Elysia()
	.use(absoluteRequestContext)
	.use(cacheTagEmitter())
	.get('/greeting', () =>
		page(`hello ${cookies().get('user') ?? 'stranger'}`)
	)
	.get('/everything', () => {
		const jar = cookies();
		const all = headers();

		return page(
			[
				jar.has('theme'),
				Object.keys(jar.getAll()).length,
				all.get('Accept-Language'),
				all.get('accept-language'),
				all.has('X-Forwarded-Proto'),
				[...all].length > 0
			].join(' ')
		);
	})
	.get('/plain', () => page('nothing personal'));

const ask = (path: string, extra: Record<string, string> = {}) =>
	app.handle(
		new Request(`http://localhost${path}`, {
			headers: {
				'accept-language': 'fr-CA',
				cookie: 'user=ada; theme=dark',
				...extra
			}
		})
	);

const asPrerenderer: Record<string, string> = {
	[PRERENDER_BYPASS_HEADER]: PRERENDER_BYPASS_TOKEN,
	[SHELL_HEADER]: '1'
};

const readsOf = (response: Response) =>
	decodeCacheTags(response.headers.get(REQUEST_READS_HEADER));

describe('what a page reads while it is pre-rendered', () => {
	test('is reported to the pre-renderer, by name', async () => {
		const response = await ask('/greeting', asPrerenderer);

		expect(readsOf(response)).toEqual(["cookies().get('user')"]);
	});

	test('covers every way of reading, each once, header names in one case', async () => {
		const response = await ask('/everything', asPrerenderer);

		expect(readsOf(response)).toEqual([
			"cookies().has('theme')",
			'cookies().getAll()',
			"headers().get('accept-language')",
			"headers().has('x-forwarded-proto')",
			'headers()'
		]);
	});

	test('is nothing for a page that reads nothing', async () => {
		const response = await ask('/plain', asPrerenderer);

		expect(response.headers.has(REQUEST_READS_HEADER)).toBe(false);
	});
});

describe('a visitor’s request', () => {
	/* The helpers must return exactly what they did before this
	 * existed, and nothing about what a page reads leaves the server. */
	test('reads the request as ever, and is told nothing', async () => {
		const response = await ask('/greeting');

		expect(await response.text()).toContain('hello ada');
		expect(response.headers.has(REQUEST_READS_HEADER)).toBe(false);
	});

	test('gets the same values from headers() as a pre-render does', async () => {
		const visitor = await (await ask('/everything')).text();
		const prerendered = await (
			await ask('/everything', asPrerenderer)
		).text();

		expect(visitor).toContain('true 2 fr-CA fr-CA false true');
		// The noting wrapper changes what is recorded, never what
		// is returned.
		expect(prerendered).toContain('true 2 fr-CA fr-CA false true');
	});

	test('is not noted for the shell header alone, or for a forged token', async () => {
		const shellOnly = await ask('/greeting', { [SHELL_HEADER]: '1' });
		const forged = await ask('/greeting', {
			[PRERENDER_BYPASS_HEADER]: 'guessed',
			[SHELL_HEADER]: '1'
		});

		expect(shellOnly.headers.has(REQUEST_READS_HEADER)).toBe(false);
		expect(forged.headers.has(REQUEST_READS_HEADER)).toBe(false);
	});
});

describe('the pre-renderer, told a page read the request', () => {
	let root = '';
	let server: ReturnType<typeof Bun.serve> | undefined;

	beforeAll(async () => {
		root = await mkdtemp(join(tmpdir(), 'absolute-request-reads-'));
		// The app above, on a port: what the build's pre-render and a
		// running server's re-render both fetch from.
		server = Bun.serve({
			port: 0,
			fetch: (request) => {
				const { pathname } = new URL(request.url);
				const responseHeaders = new Headers({
					'content-type': 'text/html'
				});
				if (pathname === '/greeting')
					responseHeaders.set(
						REQUEST_READS_HEADER,
						"cookies().get('user')"
					);

				return new Response(
					`<!DOCTYPE html><html><head><title>t</title></head><body>${pathname}</body></html>`,
					{ headers: responseHeaders }
				);
			}
		});
	});

	afterAll(async () => {
		await server?.stop(true);
		await rm(root, { force: true, recursive: true });
	});

	test('the build lists the route as a warning, and still pre-renders it', async () => {
		const result = await prerender(server?.port ?? 0, join(root, 'built'), {
			routes: ['/greeting', '/plain']
		});

		expect(result.warnings).toEqual([
			{ reads: ["cookies().get('user')"], route: '/greeting' }
		]);
		expect([...result.routes.keys()].sort()).toEqual([
			'/greeting',
			'/plain'
		]);
		expect(result.failures).toEqual([]);
	});

	test('the warning says what was read, what that means and what to do', () => {
		const line = formatPrerenderWarning({
			reads: ["cookies().get('user')", "headers().get('host')"],
			route: '/greeting'
		});

		expect(line).toContain('/greeting read the request');
		expect(line).toContain("cookies().get('user'), headers().get('host')");
		expect(line).toContain('every visitor is served that copy');
		expect(line).toContain('dynamic slot');
	});

	/* A page on a one-minute interval must not say this every minute. */
	test('a running server logs it once per route, however often it re-renders', async () => {
		const logged = spyOn(console, 'log').mockImplementation(
			() => undefined
		);
		try {
			const dir = join(root, 'live');
			await rerenderRoute('/greeting', server?.port ?? 0, dir);
			await rerenderRoute('/greeting', server?.port ?? 0, dir);
			await rerenderRoute('/plain', server?.port ?? 0, dir);

			const lines = logged.mock.calls
				.map((call) => String(call[0]))
				.filter((line) => line.includes('read the request'));
			expect(lines).toHaveLength(1);
			expect(lines[0]).toContain('/greeting');
		} finally {
			logged.mockRestore();
		}
	});
});
