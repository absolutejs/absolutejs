import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { fileRoutes } from '../../../src/core/fileRoutes';
import { reactFileRoute } from '../../../src/react/fileRoute';

/* A React file route with `ssr = false` must not import the page's
 * module on the server. That import is what such a route often cannot
 * survive: a library that touches `window` as it loads fails there, long
 * before any render, so skipping the render alone would leave the route
 * just as broken. */

type PageLoader = () => Promise<{ default: () => null }>;

const pageThatCannotLoadOnAServer: PageLoader = async () => {
	throw new Error('the page module was imported on the server');
};

const manifest: Record<string, string> = {
	RouteDashboardIndex: '/RouteDashboardIndex.abc123.js'
};

const routeWith = (ssr: boolean) =>
	reactFileRoute({
		name: 'RouteDashboard',
		page: pageThatCannotLoadOnAServer,
		path: '/dashboard',
		source: 'react/routes/dashboard.tsx',
		server: async () => ({ ssr, load: () => ({ team: 'core' }) })
	});

const get = (ssr: boolean) =>
	new Elysia()
		.use(fileRoutes([routeWith(ssr)], manifest))
		.handle(new Request('http://localhost/dashboard'));

describe('a React file route with ssr = false', () => {
	test('answers with the shell, never loading the page module', async () => {
		const response = await get(false);
		const html = await response.text();

		expect(response.status).toBe(200);
		expect(html).toContain('window.__ABSOLUTE_PAGE_RENDER_MODE__="client"');
		// The entry the browser renders with, and the props `load` returned.
		expect(html).toContain('src="/RouteDashboardIndex.abc123.js"');
		expect(html).toContain('"team":"core"');
		expect(html).not.toContain('the page module was imported');
	});

	/* The control: with rendering on, the same route does import its
	 * page, so the assertion above is about `ssr`, not about a page
	 * loader nothing ever calls. */
	test('with ssr on, the page module is imported', async () => {
		const consoleError = console.error;
		console.error = () => {};
		try {
			const response = await get(true);

			// The loader threw, so the route failed. The message itself is
			// only shown in development, so the status is what is asserted.
			expect(response.status).toBe(500);
			expect(await response.text()).not.toContain(
				'__ABSOLUTE_PAGE_RENDER_MODE__'
			);
		} finally {
			console.error = consoleError;
		}
	});
});
