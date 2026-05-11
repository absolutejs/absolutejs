import { describe, expect, test, afterAll } from 'bun:test';
import { startDevServer, type DevServer } from '../../../helpers/devServer';

let server: DevServer;

afterAll(async () => {
	await server?.kill();
});

/* The HTML/HTMX asset rewriter rewrites *relative* `href` / `src`
 * values (e.g. `../../styles/indexes/html-example.css`) into hashed
 * `/indexes/...` URLs from the manifest, but absolute paths like
 * `/assets/ico/favicon.ico` must pass through unchanged so they
 * keep resolving against the static-mounted `assetsDirectory`.
 *
 * Regression scope: an earlier version of the rewriter accidentally
 * prefixed absolute hrefs with the cwd, breaking favicon and any
 * other absolute asset link in HTML/HTMX pages. */
describe('Absolute /assets/... hrefs survive the HTML/HTMX rewriter', () => {
	test('setup', async () => {
		server = await startDevServer();
	}, 60_000);

	test('HTML page keeps `/assets/ico/favicon.ico` href unchanged', async () => {
		const html = await (await fetch(`${server.baseUrl}/html`)).text();
		expect(html).toContain('href="/assets/ico/favicon.ico"');
	});

	test('HTMX page keeps `/assets/ico/favicon.ico` href unchanged', async () => {
		const html = await (await fetch(`${server.baseUrl}/htmx`)).text();
		expect(html).toContain('href="/assets/ico/favicon.ico"');
	});

	test('The absolute href actually resolves to the favicon', async () => {
		const res = await fetch(`${server.baseUrl}/assets/ico/favicon.ico`);
		expect(res.status).toBe(200);
		// favicon.ico has the well-known ICO header (0,0,1,0)
		const buf = new Uint8Array(await res.arrayBuffer());
		expect(buf.length).toBeGreaterThan(0);
	});
});
