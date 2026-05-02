import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { getAvailablePort } from '../../helpers/ports';
import { prerender } from '../../../src/core/prerender';

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

				return new Response('<!doctype html><h1>Page</h1>', {
					headers: { 'content-type': 'text/html; charset=utf-8' }
				});
			}
		});

		try {
			const result = await prerender(port, outDir, {
				routes: ['/', '/json']
			});

			expect(result.routes.has('/')).toBe(true);
			expect(result.routes.has('/json')).toBe(false);
			await expect(
				readFile(join(outDir, '_prerendered', 'json.html'), 'utf-8')
			).rejects.toThrow();
		} finally {
			server.stop(true);
			await rm(outDir, { force: true, recursive: true });
		}
	});
});
