import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { getAvailablePort } from '../../helpers/ports';
import {
	PRERENDER_BYPASS_HEADER,
	PRERENDER_BYPASS_TOKEN,
	isPrerenderBypass,
	prerender
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
