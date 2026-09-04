import { afterAll, describe, expect, test } from 'bun:test';
import { ABSOLUTE_ROUTE_DATA_MEDIA_TYPE } from '../../../src/mobile/pageProtocol';
import { openReadyPage, type BrowserSession } from '../../helpers/browser';
import { startDevServer, type DevServer } from '../../helpers/devServer';

/* The same hover, in a real browser.
 *
 * `example/react/pages/ReactExample.tsx` renders
 * `<Link href="/vue" id="vue-link" prefetch="hover">`. Hovering it must
 * fire the document + route-data pair and, once the route data lands,
 * inject the `<link rel="modulepreload">` / `<link rel="prefetch">` tags
 * the click then reuses. */

type ObservedRequest = { accept: string; method: string; url: string };

let server: DevServer | undefined;
let session: BrowserSession | undefined;

afterAll(async () => {
	await session?.close();
	await server?.kill();
}, 30_000);

const linkHrefs = (rel: string) =>
	`Array.from(document.head.querySelectorAll('link[rel="${rel}"]')).map((link) => link.getAttribute('href'))`;

describe('dev: hovering a <Link> in the browser', () => {
	test('warms the document, the route data and the page modules', async () => {
		server = await startDevServer();
		const base = server.baseUrl;
		// Build /vue up front: this test is about what the browser does on
		// hover, not about the on-demand build (that is
		// route-data-prefetch.test.ts), so the page is already warm.
		expect((await fetch(`${base}/vue`)).status).toBe(200);

		const observed: ObservedRequest[] = [];
		session = await openReadyPage(`${base}/react`, async (page) => {
			page.on('request', (request) => {
				observed.push({
					accept: request.headers()['accept'] ?? '',
					method: request.method(),
					url: request.url()
				});
			});
			// React must have hydrated before the anchor carries the hover
			// handler: prove it by driving the counter's client state.
			await page.waitForSelector('#vue-link', { timeout: 15_000 });
			await page.click('main button');
			await page.waitForFunction(
				() =>
					document
						.querySelector('main button')
						?.textContent?.includes('count is 1') === true,
				undefined,
				{ timeout: 15_000 }
			);
		});
		const { page } = session;

		const preloadedBeforeHover: string[] = await page.evaluate(
			linkHrefs('modulepreload')
		);
		expect(
			preloadedBeforeHover.some((href) => href.includes('VueExample'))
		).toBe(false);

		observed.length = 0;
		await page.hover('#vue-link');
		// The hover trigger is debounced (250ms); the modulepreload tag can
		// only appear once the route-data payload has been parsed.
		await page.waitForFunction(
			() =>
				document.head.querySelector(
					'link[rel="modulepreload"][href*="VueExample"]'
				) !== null,
			undefined,
			{ timeout: 15_000 }
		);

		const vueRequests = observed.filter(({ url }) =>
			url.startsWith(`${base}/vue`)
		);
		// One document request and one route-data request, both GET.
		expect(
			vueRequests.filter(({ accept }) =>
				accept.includes(ABSOLUTE_ROUTE_DATA_MEDIA_TYPE)
			)
		).toHaveLength(1);
		expect(
			vueRequests.filter(
				({ accept }) => !accept.includes(ABSOLUTE_ROUTE_DATA_MEDIA_TYPE)
			).length
		).toBeGreaterThanOrEqual(1);
		expect(vueRequests.every(({ method }) => method === 'GET')).toBe(true);

		// The envelope's assets are now warm in the document: the page's
		// client entry as a module, its stylesheets as prefetches.
		const modules: string[] = await page.evaluate(
			linkHrefs('modulepreload')
		);
		expect(modules.some((href) => href.includes('VueExample'))).toBe(true);
		const styles: string[] = await page.evaluate(linkHrefs('prefetch'));
		expect(styles.length).toBeGreaterThan(0);
		expect(styles.every((href) => href.endsWith('.css'))).toBe(true);

		// …and the click that follows is an ordinary navigation onto the
		// page whose modules were just preloaded.
		await Promise.all([
			page.waitForURL(`${base}/vue`, { timeout: 15_000 }),
			page.click('#vue-link')
		]);
		expect(new URL(page.url()).pathname).toBe('/vue');
		const loadedModules: string[] = await page.evaluate(
			`performance.getEntriesByType('resource').map((entry) => entry.name)`
		);
		expect(loadedModules.some((name) => name.includes('VueExample'))).toBe(
			true
		);
	}, 180_000);
});
