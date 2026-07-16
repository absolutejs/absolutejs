import { describe, expect, test, afterAll, afterEach } from 'bun:test';
import { resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { connectHMR, type HMRClient } from '../../../helpers/ws';
import { mutateFile, restoreAllFiles } from '../../../helpers/file';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');

let server: DevServer;
let client: HMRClient;

afterEach(() => {
	restoreAllFiles();
});

afterAll(async () => {
	client?.close();
	await server?.kill();
});

const POLL_INTERVAL_MS = 500;

const fetchSpaPage = async () =>
	(await fetch(`${server.baseUrl}/spashell/one`)).text();

/* SPA shells SSR-inline the matched child route's compiled CSS via the
 * page's `.spa.json` side manifest (utils/spaRouteCss.ts). Editing the
 * child's scoped style must reach a FRESH full-page load without a dev
 * server restart. This used to fail three ways: the dev bundle rebuild
 * never re-emitted the side manifest next to the new SSR hash, the
 * runtime cached both the manifest and the CSS text forever, and a
 * failed bundle rebuild silently dropped its file batch. */
describe('SPA child route style edits reach SSR', () => {
	test('setup: start server and connect', async () => {
		server = await startDevServer();
		client = await connectHMR(server.port);
		await client.waitFor('manifest');
		await client.waitFor('connected');
		client.drain();
	}, 60_000);

	test('child scoped-style edit lands in a fresh SSR response', async () => {
		const child = resolve(PROJECT_ROOT, 'example/vue/pages/SpaOne.vue');

		// Baseline: the side manifest inlines the child CSS on first paint.
		const before = await fetchSpaPage();
		expect(before).toContain('#123456');

		client.drain();
		mutateFile(child, (c) => c.replace('#123456', '#ab12cd'));

		// The shell's SSR bundle is large — its rebuild (2s debounce + full
		// Bun.build) can take tens of seconds, so give the poll real room.
		const deadline = Date.now() + 60_000;
		let html = '';
		while (Date.now() < deadline) {
			html = await fetchSpaPage();
			if (html.includes('#ab12cd')) break;
			await Bun.sleep(POLL_INTERVAL_MS);
		}
		expect(html).toContain('#ab12cd');
		expect(html).not.toContain('#123456');
	}, 120_000);
});
