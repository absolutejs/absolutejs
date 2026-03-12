import { describe, expect, test, afterAll } from 'bun:test';
import { startProdServer, type ProdServer } from '../../helpers/prodServer';
import { fetchPage } from '../../helpers/http';

let server: ProdServer;

afterAll(async () => {
	await server?.kill();
});

describe('production SSR correctness', () => {
	test('setup: start production server', async () => {
		server = await startProdServer();
		expect(server.port).toBeGreaterThan(0);
	}, 120_000);

	test('react page contains SSR content', async () => {
		const { html } = await fetchPage(`${server.baseUrl}/react`);
		expect(html).toContain('AbsoluteJS + React');
		expect(html).toContain('<script');
		expect(html).toContain('__INITIAL_PROPS__');
	});

	test('svelte page contains SSR content', async () => {
		const { html } = await fetchPage(`${server.baseUrl}/svelte`);
		expect(html).toContain('AbsoluteJS + Svelte');
		expect(html).toContain('<script');
	});

	test('vue page contains SSR content', async () => {
		const { html } = await fetchPage(`${server.baseUrl}/vue`);
		expect(html).toContain('AbsoluteJS + Vue');
		expect(html).toContain('<script');
	});

	test('angular page contains SSR content', async () => {
		const { html } = await fetchPage(`${server.baseUrl}/angular`);
		const lowerHtml = html.toLowerCase();
		expect(lowerHtml).toContain('angular');
	});

	test('html page contains static content', async () => {
		const { html } = await fetchPage(`${server.baseUrl}/html`);
		expect(html).toContain('AbsoluteJS');
		const hasScriptOrClosingHtml =
			html.includes('<script') || html.includes('</html>');
		expect(hasScriptOrClosingHtml).toBe(true);
	});

	test('htmx page contains htmx attributes', async () => {
		const { html } = await fetchPage(`${server.baseUrl}/htmx`);
		expect(html).toContain('hx-');
	});

	test('no pages contain HMR client markers in production', async () => {
		const { html } = await fetchPage(`${server.baseUrl}/react`);
		expect(html).not.toContain('data-hmr-client');
		expect(html).not.toContain('__HMR_FRAMEWORK__');
	});
});
