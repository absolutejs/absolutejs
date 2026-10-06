import { afterEach, describe, expect, test } from 'bun:test';
import { chromium, type Browser } from 'playwright';
import { startDevServer, type DevServer } from '../../../helpers/devServer';

/* With `dev.https`, the dev server also speaks HTTP/2 (Bun 1.4.1+
 * `Bun.serve({ http2: true })`), so a real browser fetches page modules
 * multiplexed over one connection instead of HTTP/1.1's six. Bun does not
 * carry WebSockets over HTTP/2 (RFC 8441), so Chromium opens the HMR
 * socket as a separate HTTP/1.1 connection on the same port — this test
 * pins both halves, since either one silently regressing would cost the
 * whole point (no multiplexing) or HMR itself (no socket). */

let server: DevServer | undefined;
let browser: Browser | undefined;

afterEach(async () => {
	await browser?.close();
	browser = undefined;
	await server?.kill();
	server = undefined;
}, 30_000);

describe('HTTPS dev server in a browser', () => {
	test('serves modules over HTTP/2 and keeps the HMR socket', async () => {
		server = await startDevServer({ https: true });
		browser = await chromium.launch({
			args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
			headless: process.env.ABSOLUTE_TEST_HEADLESS !== 'false'
		});
		const context = await browser.newContext({ ignoreHTTPSErrors: true });
		const page = await context.newPage();
		const cdp = await context.newCDPSession(page);
		await cdp.send('Network.enable');

		const scriptProtocols: string[] = [];
		cdp.on('Network.responseReceived', ({ response, type }) => {
			if (type === 'Script' && typeof response.protocol === 'string')
				scriptProtocols.push(response.protocol);
		});
		const hmrSocket = new Promise<string>((resolve) => {
			page.on('websocket', (socket) => {
				if (!socket.url().includes('/hmr')) return;
				socket.on('framereceived', () => resolve(socket.url()));
			});
		});

		await page.goto(`${server.baseUrl}/react`, { waitUntil: 'load' });

		expect(scriptProtocols.length).toBeGreaterThan(0);
		expect(scriptProtocols.every((protocol) => protocol === 'h2')).toBe(
			true
		);
		expect(
			await Promise.race([
				hmrSocket,
				Bun.sleep(15_000).then(() => 'no HMR frame within 15s')
			])
		).toStartWith('wss://');
	}, 120_000);
});
