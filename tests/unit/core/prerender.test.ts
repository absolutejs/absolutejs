import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { getAvailablePort } from '../../helpers/ports';
import {
	PRERENDER_BYPASS_HEADER,
	PRERENDER_BYPASS_TOKEN,
	isPrerenderBypass,
	prerender,
	shouldSkipPrerendered
} from '../../../src/core/prerender';

describe('prerender bypass', () => {
	const withHeader = (value: string) =>
		new Request('http://localhost/', {
			headers: { [PRERENDER_BYPASS_HEADER]: value }
		});

	test("only this process's token skips the pre-render cache", () => {
		expect(isPrerenderBypass(withHeader(PRERENDER_BYPASS_TOKEN))).toBe(
			true
		);
		expect(isPrerenderBypass(withHeader('1'))).toBe(false);
		expect(isPrerenderBypass(new Request('http://localhost/'))).toBe(false);
	});

	test('the token is not a guessable constant', () => {
		expect(PRERENDER_BYPASS_TOKEN.length).toBeGreaterThanOrEqual(32);
	});
});

describe('skipping the pre-rendered file', () => {
	const withCookie = (cookie: string) =>
		new Request('http://localhost/', { headers: { cookie } });
	const accepting = (accept: string) =>
		new Request('http://localhost/', { headers: { accept } });

	/* The file is an HTML document. For a request that asked for the
	 * page's data it is the wrong answer, and the route has the right
	 * one. */
	test('a request for the page’s data is answered by the route', () => {
		expect(
			shouldSkipPrerendered(
				accepting('application/vnd.absolute.route+json')
			)
		).toBe(true);
		expect(
			shouldSkipPrerendered(
				accepting('application/vnd.absolute.native-route+json')
			)
		).toBe(true);
		expect(
			shouldSkipPrerendered(
				accepting('application/vnd.absolute.page+json')
			)
		).toBe(true);
	});

	test('a browser asking for the document still gets the cached file', () => {
		expect(
			shouldSkipPrerendered(
				accepting('text/html,application/xhtml+xml,*/*;q=0.8')
			)
		).toBe(false);
		expect(shouldSkipPrerendered(accepting('application/json'))).toBe(
			false
		);
	});

	test('an ordinary visitor is served the cached file', () => {
		expect(shouldSkipPrerendered(new Request('http://localhost/'))).toBe(
			false
		);
		expect(shouldSkipPrerendered(withCookie('theme=dark'))).toBe(false);
	});

	test("the server's own re-render request skips it", () => {
		expect(
			shouldSkipPrerendered(
				new Request('http://localhost/', {
					headers: {
						[PRERENDER_BYPASS_HEADER]: PRERENDER_BYPASS_TOKEN
					}
				})
			)
		).toBe(true);
	});

	test('a form result waiting in the cookie skips it', () => {
		// Without this the visitor gets the page as it was built: no
		// errors, nothing typed back, their submission apparently ignored.
		expect(shouldSkipPrerendered(withCookie('absolute_action=abc'))).toBe(
			true
		);
		expect(
			shouldSkipPrerendered(withCookie('theme=dark; absolute_action=abc'))
		).toBe(true);
	});

	test('a lookalike cookie does not skip it', () => {
		// Matched by name, so neither a longer name nor a value that
		// mentions it counts.
		expect(
			shouldSkipPrerendered(withCookie('absolute_action_other=1'))
		).toBe(false);
		expect(
			shouldSkipPrerendered(withCookie('theme=absolute_action=nope'))
		).toBe(false);
	});
});

describe('prerender', () => {
	test('only caches HTML responses as pre-rendered pages', async () => {
		const port = await getAvailablePort();
		const outDir = await mkdtemp(join(process.cwd(), '.tmp-prerender-'));
		const server = Bun.serve({
			port,
			fetch(request) {
				const url = new URL(request.url);
				if (url.pathname === '/json') {
					return Response.json({ ok: true });
				}
				if (url.pathname === '/incomplete') {
					return new Response(
						'<!doctype html><html><body>truncated',
						{
							headers: {
								'content-type': 'text/html; charset=utf-8'
							}
						}
					);
				}

				return new Response(
					'<!doctype html><html><body><h1>Page</h1></body></html>',
					{
						headers: { 'content-type': 'text/html; charset=utf-8' }
					}
				);
			}
		});

		try {
			const result = await prerender(port, outDir, {
				routes: ['/', '/json', '/incomplete']
			});

			expect(result.routes.has('/')).toBe(true);
			expect(result.routes.has('/json')).toBe(false);
			expect(result.routes.has('/incomplete')).toBe(false);
			await expect(
				readFile(join(outDir, '_prerendered', 'json.html'), 'utf-8')
			).rejects.toThrow();
			await expect(
				readFile(
					join(outDir, '_prerendered', 'incomplete.html'),
					'utf-8'
				)
			).rejects.toThrow();
		} finally {
			server.stop(true);
			await rm(outDir, { force: true, recursive: true });
		}
	});
});
