import { describe, expect, test, afterAll } from 'bun:test';
import { startProdServer, type ProdServer } from '../../helpers/prodServer';
import { fetchPage } from '../../helpers/http';

let server: ProdServer;

afterAll(async () => {
	await server?.kill();
});

describe('production server startup', () => {
	test('builds and starts production server', async () => {
		server = await startProdServer();
		expect(server.port).toBeGreaterThan(0);
	}, 120_000);

	test('serves root page', async () => {
		const { status } = await fetchPage(server.baseUrl);
		expect(status).toBe(200);
	});

	test('serves all framework pages', async () => {
		const routes = [
			'/html',
			'/react',
			'/svelte',
			'/vue',
			'/angular',
			'/htmx'
		];
		for (const route of routes) {
			const { status } = await fetchPage(`${server.baseUrl}${route}`);
			expect(status).toBe(200);
		}
	});

	test('hmr-status endpoint does NOT exist in production', async () => {
		const res = await fetch(`${server.baseUrl}/hmr-status`);
		// Should be 404 since HMR plugin is stubbed in production
		expect(res.status).toBe(404);
	});

	test('pages do NOT contain HMR client in production', async () => {
		const { html } = await fetchPage(`${server.baseUrl}/react`);
		// The HMR WebSocket connection code should not be present
		expect(html).not.toContain('ws://');
		expect(html).not.toContain('wss://');
	});

	test('static assets have cache headers', async () => {
		const { html } = await fetchPage(`${server.baseUrl}/react`);
		// Extract a script src to test its headers
		const scriptMatch = html.match(/src="([^"]+\.js[^"]*)"/);
		if (scriptMatch?.[1]) {
			const assetUrl = `${server.baseUrl}${scriptMatch[1]}`;
			const res = await fetch(assetUrl);
			if (res.ok) {
				const cacheControl = res.headers.get('cache-control');
				expect(cacheControl).toContain('max-age');
			}
		}
	});
});
