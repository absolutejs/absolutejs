import { describe, expect, test, afterAll, beforeAll } from 'bun:test';
import { startDevServer, type DevServer } from '../../helpers/devServer';
import { fetchPage } from '../../helpers/http';

let server: DevServer;

beforeAll(async () => {
	server = await startDevServer();
}, 60_000);

afterAll(async () => {
	await server?.kill();
});

type FrameworkRoute = { name: string; path: string };

const frameworkRoutes: FrameworkRoute[] = [
	{ name: 'html', path: '/html' },
	{ name: 'react', path: '/react' },
	{ name: 'svelte', path: '/svelte' },
	{ name: 'vue', path: '/vue' },
	{ name: 'angular', path: '/angular' },
	{ name: 'htmx', path: '/htmx' }
];

describe('SSR page loading', () => {
	test.each(frameworkRoutes)('$name page returns 200', async ({ path }) => {
		const { status } = await fetchPage(`${server.baseUrl}${path}`);
		expect(status).toBe(200);
	});

	test.each(frameworkRoutes)(
		'$name page returns valid HTML',
		async ({ path }) => {
			const { html } = await fetchPage(`${server.baseUrl}${path}`);
			expect(html).toContain('<html');
			expect(html.toLowerCase()).toContain('</html>');
		}
	);

	test.each(frameworkRoutes)(
		'$name page includes client script',
		async ({ path }) => {
			const { html } = await fetchPage(`${server.baseUrl}${path}`);
			// All pages should include a script tag (hydration or HMR client is bundled inside)
			expect(html).toContain('<script');
		}
	);

	test('root route serves HTML page', async () => {
		const { status, html } = await fetchPage(server.baseUrl);
		expect(status).toBe(200);
		expect(html).toContain('<html');
	});
});

describe('React SSR', () => {
	test('includes hydration script', async () => {
		const { html } = await fetchPage(`${server.baseUrl}/react`);
		expect(html).toContain('<script');
		expect(html).toContain('__INITIAL_PROPS__');
	});

	test('renders server content', async () => {
		const { html } = await fetchPage(`${server.baseUrl}/react`);
		// The page should have actual rendered content, not just an empty shell
		expect(html.length).toBeGreaterThan(500);
	});
});

describe('Svelte SSR', () => {
	test('includes hydration script', async () => {
		const { html } = await fetchPage(`${server.baseUrl}/svelte`);
		expect(html).toContain('<script');
	});

	test('renders server content', async () => {
		const { html } = await fetchPage(`${server.baseUrl}/svelte`);
		expect(html.length).toBeGreaterThan(500);
	});
});

describe('Vue SSR', () => {
	test('includes hydration script', async () => {
		const { html } = await fetchPage(`${server.baseUrl}/vue`);
		expect(html).toContain('<script');
	});

	test('includes CSS link', async () => {
		const { html } = await fetchPage(`${server.baseUrl}/vue`);
		expect(html).toContain('stylesheet');
	});

	test('renders server content', async () => {
		const { html } = await fetchPage(`${server.baseUrl}/vue`);
		expect(html.length).toBeGreaterThan(500);
	});
});

describe('Angular SSR', () => {
	test('includes bootstrap script', async () => {
		const { html } = await fetchPage(`${server.baseUrl}/angular`);
		expect(html).toContain('<script');
	});

	test('renders server content', async () => {
		const { html } = await fetchPage(`${server.baseUrl}/angular`);
		expect(html.length).toBeGreaterThan(500);
	});
});

describe('HTML page', () => {
	test('serves static HTML', async () => {
		const { html } = await fetchPage(`${server.baseUrl}/html`);
		expect(html).toContain('<html');
	});
});

describe('HTMX page', () => {
	test('serves HTMX page', async () => {
		const { html } = await fetchPage(`${server.baseUrl}/htmx`);
		expect(html).toContain('<html');
	});

	test('HTMX count endpoint works', async () => {
		const res = await fetch(`${server.baseUrl}/htmx/count`);
		expect(res.ok).toBe(true);
	});
});
