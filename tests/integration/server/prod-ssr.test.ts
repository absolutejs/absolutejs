import { describe, expect, test, afterAll } from 'bun:test';
import { startProdServer, type ProdServer } from '../../helpers/prodServer';
import { fetchPage } from '../../helpers/http';
import { openPage } from '../../helpers/browser';

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

	/* The SPA shell exports `routes`, so its SSR page bundle inlines
	 * vue-router, whose ESM build reads Vue's feature flags as free globals.
	 * The production server pass didn't define them, and every request
	 * failed with `__VUE_PROD_DEVTOOLS__ is not defined`. */
	test('vue page exporting routes renders a nested URL', async () => {
		const { html, status } = await fetchPage(
			`${server.baseUrl}/spashell/one`
		);
		expect(status).toBe(200);
		expect(html).not.toContain('is not defined');
		expect(html).toContain('<div id="root">');
		expect(html).toMatch(
			/<script type="module" src="[^"]*SpaShell[^"]*\.js"/
		);
	});

	test('vue page exporting routes mounts and navigates client-side', async () => {
		const session = await openPage(`${server.baseUrl}/spashell/one`);
		try {
			const { page } = session;
			await page.waitForSelector('.spa-one', { timeout: 15_000 });
			expect(await page.textContent('.spa-shell h1')).toBe('SPA Shell');
			expect(await page.textContent('.spa-one')).toBe('SPA_ONE_CONTENT');
			// A full reload would drop this marker.
			await page.evaluate(() => {
				Reflect.set(window, '__spaNavigationMarker', true);
			});
			await page.click('.spa-link-two');
			await page.waitForSelector('.spa-two', { timeout: 15_000 });
			expect(await page.textContent('.spa-two')).toBe('SPA_TWO_CONTENT');
			expect(new URL(page.url()).pathname).toBe('/spashell/two');
			expect(
				await page.evaluate(() =>
					Reflect.get(window, '__spaNavigationMarker')
				)
			).toBe(true);
		} finally {
			await session.close();
		}
	}, 60_000);

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
