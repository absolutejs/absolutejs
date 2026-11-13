import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openPage } from '../../helpers/browser';
import { startProdServer, type ProdServer } from '../../helpers/prodServer';

/* `absolute start` served the build's runtime manifest at /manifest.json.
 * It maps every SSR page and server bundle to an absolute path on the
 * server's disk, so anyone could read the server's file layout. The
 * browser never fetches it (hydration entries are already in the page), so
 * production now 404s it like the other runtime files, and no page carries
 * a server path. */

let server: ProdServer;

beforeAll(async () => {
	server = await startProdServer();
}, 180_000);

afterAll(async () => {
	await server?.kill();
});

const PAGE_ROUTES = ['/', '/react', '/svelte', '/vue', '/angular', '/htmx'];
// The HTML example's counter script (`/html/scripts/typescript-example.ts`)
// is not rewritten to its built path and 404s in production, with or
// without this change, so `/` is left out of the hydration check.
const HYDRATED_ROUTES = ['/react', '/svelte', '/vue', '/angular', '/htmx'];

describe('production does not publish server file paths', () => {
	test('the build wrote a runtime manifest with absolute server paths', () => {
		const manifestPath = join(server.outdir, 'manifest.json');
		expect(existsSync(manifestPath)).toBe(true);
		const manifest: Record<string, string> = JSON.parse(
			readFileSync(manifestPath, 'utf-8')
		);
		expect(
			Object.values(manifest).some((value) =>
				value.startsWith(server.outdir)
			)
		).toBe(true);
	});

	test('GET /manifest.json and its compressed copies are 404', async () => {
		const requests: [string, Record<string, string>][] = [
			['/manifest.json', {}],
			['/manifest.json', { 'accept-encoding': 'br, gzip' }],
			['/manifest.json.br', {}],
			['/manifest.json.gz', {}]
		];
		for (const [path, headers] of requests) {
			const response = await fetch(`${server.baseUrl}${path}`, {
				headers
			});
			const body = await response.text();

			expect(`${path} ${response.status}`).toBe(`${path} 404`);
			expect(body).not.toContain(server.outdir);
		}
	});

	test('no page HTML contains a server path', async () => {
		for (const route of PAGE_ROUTES) {
			const response = await fetch(`${server.baseUrl}${route}`);
			const html = await response.text();

			expect(response.status).toBe(200);
			expect(html).not.toContain(server.outdir);
		}
	});

	test('every framework still hydrates', async () => {
		const session = await openPage('about:blank');
		const failedRequests: string[] = [];
		session.page.on('response', (response) => {
			if (response.status() >= 400) failedRequests.push(response.url());
		});
		try {
			for (const route of HYDRATED_ROUTES) {
				await session.page.goto(`${server.baseUrl}${route}`, {
					waitUntil: 'load'
				});
				// Each example page has a "count is N" counter. A click that
				// changes N proves the page hydrated.
				const counter = session.page
					.locator('button', { hasText: 'count is' })
					.first();
				const readCount = async () =>
					Number(
						/count is\s*(\d+)/.exec(
							(await counter.textContent()) ?? ''
						)?.[1] ?? Number.NaN
					);
				const before = await readCount();
				expect(`${route} ${Number.isFinite(before)}`).toBe(
					`${route} true`
				);
				const deadline = Date.now() + 15_000;
				let after = before;
				while (after === before && Date.now() < deadline) {
					await counter.click();
					await Bun.sleep(200);
					after = await readCount();
				}
				expect(`${route} ${after > before}`).toBe(`${route} true`);
			}
		} finally {
			await session.close();
		}
		expect(
			failedRequests.filter((url) => url.endsWith('manifest.json'))
		).toEqual([]);
	}, 180_000);
});
