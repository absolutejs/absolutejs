import { afterEach, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import type { Page } from 'playwright';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { connectHMR, type HMRClient } from '../../../helpers/ws';
import { mutateFile, restoreAllFiles } from '../../../helpers/file';
import { openReadyPage, type BrowserSession } from '../../../helpers/browser';

/* Every framework's page under secureHeaders(): it loads, hydrates and
 * hot-updates in a browser that enforces the nonce-based policy, with no
 * violation, and every inline <script>/<style> carries the header's
 * nonce. */

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');
const serverEntry = resolve(PROJECT_ROOT, 'example/server.ts');
const htmlPage = resolve(PROJECT_ROOT, 'example/html/pages/HTMLExample.html');
const sveltePage = resolve(
	PROJECT_ROOT,
	'example/svelte/pages/SvelteExample.svelte'
);

const ROUTES = ['/html', '/htmx', '/react', '/svelte', '/vue', '/angular'];

let server: DevServer | undefined;
let client: HMRClient | undefined;
let session: BrowserSession | undefined;

afterEach(async () => {
	if (session) {
		await session.close();
		session = undefined;
	}
	client?.close();
	client = undefined;
	if (server) {
		await server.kill();
		server = undefined;
	}
	restoreAllFiles();
});

const installSecureHeaders = () =>
	mutateFile(serverEntry, (source) =>
		source
			.replace(
				"import { networking } from '../src/plugins/networking';",
				"import { networking } from '../src/plugins/networking';\nimport { secureHeaders } from '../src/plugins/secureHeaders';"
			)
			.replace(
				'export const server: AnyElysia = new Elysia()\n\t.use(absolutejs)',
				"export const server: AnyElysia = new Elysia()\n\t.use(secureHeaders({ contentSecurityPolicy: { directives: { 'font-src': [\"'self'\", 'data:', 'https://fonts.gstatic.com'], 'style-src': [\"'self'\", 'https://fonts.googleapis.com'] } } }))\n\t.use(absolutejs)"
			)
	);

const readViolations = (page: Page) =>
	page.evaluate(() => {
		const list: unknown = Reflect.get(window, '__cspViolations');

		return Array.isArray(list) ? list.map(String) : [];
	});

const watchViolations = (page: Page) =>
	page.context().addInitScript(() => {
		const list: string[] = [];
		Reflect.set(window, '__cspViolations', list);
		document.addEventListener('securitypolicyviolation', (event) =>
			list.push(`${event.violatedDirective} ${event.blockedURI}`)
		);
	});

const nonceOf = (policy: string | null) =>
	policy?.match(/'nonce-([^']+)'/)?.[1] ?? '';

describe('secureHeaders() in dev', () => {
	test('every framework page loads, hydrates and hot-updates with no CSP violation', async () => {
		installSecureHeaders();
		server = await startDevServer();
		client = await connectHMR(server.port);
		await client.waitFor('manifest');
		await client.waitFor('connected');
		const { baseUrl } = server;

		// Inline tags: each carries this response's nonce (data blocks
		// such as application/json aren't scripts and are exempt).
		const untagged: Record<string, string[]> = {};
		for (const route of ROUTES) {
			const response = await fetch(`${baseUrl}${route}`);
			const nonce = nonceOf(
				response.headers.get('content-security-policy')
			);
			expect(nonce).not.toBe('');
			untagged[route] = [
				...(await response.text()).matchAll(
					/<(?:script|style)\b[^>]*>/gi
				)
			]
				.map(([tag]) => tag)
				.filter(
					(tag) =>
						!tag.includes(`nonce="${nonce}"`) &&
						!/type="application\/(?:ld\+)?json"/.test(tag)
				);
		}
		expect(untagged).toEqual(
			Object.fromEntries(ROUTES.map((r) => [r, []]))
		);

		session = await openReadyPage(`${baseUrl}/html`, async (page) => {
			await watchViolations(page);
		});
		const { page } = session;
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(String(error)));
		const violations: Record<string, string[]> = {};
		for (const route of ROUTES) {
			await page.goto(`${baseUrl}${route}`, { waitUntil: 'load' });
			await page.waitForTimeout(1_500);
			violations[route] = await readViolations(page);
		}
		expect(violations).toEqual(
			Object.fromEntries(ROUTES.map((route) => [route, []]))
		);

		// Hydrated: the Svelte counter responds to a click.
		await page.goto(`${baseUrl}/svelte`, { waitUntil: 'load' });
		const counter = page.locator('button').first();
		await counter.click();
		await page.waitForFunction(() =>
			/\b1\b/.test(document.querySelector('button')?.textContent ?? '')
		);

		// Hot updates apply without a violation.
		mutateFile(sveltePage, (source) =>
			source.replace(
				'<h1>AbsoluteJS + Svelte</h1>',
				'<h1>SVELTE_CSP_HMR</h1>'
			)
		);
		await page.waitForFunction(() =>
			document.body.innerText.includes('SVELTE_CSP_HMR')
		);
		expect(await readViolations(page)).toEqual([]);

		await page.goto(`${baseUrl}/html`, { waitUntil: 'load' });
		await page.waitForTimeout(1_000);
		mutateFile(htmlPage, (source) =>
			source.replace(
				'<h1>AbsoluteJS + HTML</h1>',
				'<h1>HTML_CSP_HMR</h1>'
			)
		);
		await page.waitForFunction(
			() => document.body.innerText.includes('HTML_CSP_HMR'),
			undefined,
			{ timeout: 30_000 }
		);
		expect(await readViolations(page)).toEqual([]);
		// Only policy errors count here: the example's Angular page also
		// logs a dev module-load error that happens without secureHeaders().
		expect(
			errors.filter((error) =>
				/Content Security Policy|EvalError|unsafe-eval/.test(error)
			)
		).toEqual([]);
	}, 180_000);
});
