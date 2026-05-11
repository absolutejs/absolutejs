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

/* Verifies the tier-0 SSR-bundle rebuild scheduled from each
 * framework's HMR fast path. Pre-fix (Angular #196 / Svelte+Vue
 * #200), surgical updates patched the running browser session
 * but the on-disk SSR bundle stayed frozen at startup-time
 * bytes, so any fresh-tab load (or curl) returned the pre-edit
 * component until the page entry itself was touched.
 *
 * The fix schedules a 2-second-debounced `Bun.build` from each
 * fast path; after the debounce, the manifest entry flips to a
 * new hash and SSR's `await import(newPath)` returns fresh
 * bytes. This test polls the SSR HTML after each edit to
 * confirm. */
const BUNDLE_REBUILD_WINDOW_MS = 8_000;

const pollFor = async (
	url: string,
	predicate: (html: string) => boolean,
	timeoutMs = BUNDLE_REBUILD_WINDOW_MS
) => {
	const deadline = Date.now() + timeoutMs;
	let lastHtml = '';
	while (Date.now() < deadline) {
		const res = await fetch(url);
		lastHtml = await res.text();
		if (predicate(lastHtml)) return lastHtml;
		await Bun.sleep(250);
	}
	throw new Error(
		`SSR did not catch up within ${timeoutMs}ms. Last body excerpt: ${lastHtml.slice(0, 200)}`
	);
};

describe('Tier-0 SSR catches up to fresh component content', () => {
	test('setup: start server and connect', async () => {
		server = await startDevServer();
		client = await connectHMR(server.port);
		await client.waitFor('manifest');
		await client.waitFor('connected');
		client.drain();
	}, 60_000);

	test('svelte: SSR returns post-edit content after debounce', async () => {
		const sveltePage = resolve(
			PROJECT_ROOT,
			'example/svelte/pages/SvelteExample.svelte'
		);

		// Pick a string we KNOW renders into the SSR body (the header
		// text). Replace it with a sentinel and poll for it.
		mutateFile(sveltePage, (c) =>
			c.replace(
				'AbsoluteJS + Svelte',
				'AbsoluteJS + Svelte SSR_TIER0_SVELTE'
			)
		);

		await pollFor(`${server.baseUrl}/svelte`, (html) =>
			html.includes('SSR_TIER0_SVELTE')
		);
	}, 30_000);

	test('vue: SSR returns post-edit content after debounce', async () => {
		const vuePage = resolve(
			PROJECT_ROOT,
			'example/vue/pages/VueExample.vue'
		);

		mutateFile(vuePage, (c) =>
			c.replace('AbsoluteJS + Vue', 'AbsoluteJS + Vue SSR_TIER0_VUE')
		);

		await pollFor(`${server.baseUrl}/vue`, (html) =>
			html.includes('SSR_TIER0_VUE')
		);
	}, 30_000);

	test('angular: SSR returns post-edit content after debounce', async () => {
		// Angular's tier-0 surgical update touches the live LView; the
		// debounced bundle rebuild is what makes fresh page loads see
		// the new content. Edit the page template that bench renders.
		const angularTemplate = resolve(
			PROJECT_ROOT,
			'example/angular/templates/angular-example.html'
		);

		// AbsoluteJS appears in the header anchor; pick a longer
		// unique fragment to mutate so we don't false-positive on
		// other pages' SSR output that gets included via nav.
		mutateFile(angularTemplate, (c) =>
			c.replace('<a href="/">AbsoluteJS</a>', '<a href="/">AbsoluteJS SSR_TIER0_NG</a>')
		);

		await pollFor(`${server.baseUrl}/angular`, (html) =>
			html.includes('SSR_TIER0_NG')
		);
	}, 30_000);
});
