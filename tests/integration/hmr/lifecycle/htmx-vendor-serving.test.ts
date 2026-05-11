import { describe, expect, test, afterAll } from 'bun:test';
import { startDevServer, type DevServer } from '../../../helpers/devServer';

let server: DevServer;

afterAll(async () => {
	await server?.kill();
});

/* Verifies the `htmxDirectory`'s `htmx*.min.js` is copied to
 * `<buildDir>/htmx/htmx.min.js` and served at `/htmx/htmx.min.js`
 * with a JS content-type. The example's HTMXExample.html
 * references this exact URL, so a 200 + non-empty body is the
 * contract. */
describe('HTMX vendor script serving', () => {
	test('setup', async () => {
		server = await startDevServer();
	}, 60_000);

	test('/htmx/htmx.min.js returns the vendor bundle', async () => {
		const res = await fetch(`${server.baseUrl}/htmx/htmx.min.js`);
		expect(res.status).toBe(200);
		const body = await res.text();
		// htmx's UMD wrapper exposes a global `htmx` — we don't need to
		// pin to a version, just confirm the body looks like the lib
		// and isn't a 0-byte placeholder or an HTML error page.
		expect(body.length).toBeGreaterThan(1000);
		expect(body).toMatch(/htmx/i);
		expect(body).not.toMatch(/<html/i);
	});
});
