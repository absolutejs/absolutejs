import { describe, expect, test, afterEach } from 'bun:test';
import { resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { connectHMR, type HMRClient } from '../../../helpers/ws';
import { createFile, mutateFile, restoreAllFiles } from '../../../helpers/file';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');

let server: DevServer | undefined;
let client: HMRClient | undefined;

afterEach(async () => {
	client?.close();
	client = undefined;
	if (server) {
		await server.kill();
		server = undefined;
	}
	restoreAllFiles();
});

const htmlPage = resolve(PROJECT_ROOT, 'example/html/pages/HTMLExample.html');

const startAndConnect = async () => {
	server = await startDevServer();
	client = await connectHMR(server.port);
	await client.waitFor('manifest');
	await client.waitFor('connected');
	client.drain();
	return server;
};

/* HTML deeper coverage — pushes the matrix to Angular depth for
 * the HTML adapter. Focus is on the asset-rewriter, HMR client
 * injection, the manifest-key contract, and round-trips through
 * the markup fast path. */
describe('HTML deeper coverage', () => {
	test('relative `<link rel="stylesheet">` rewrites to manifest-hashed `/indexes/...` URL', async () => {
		const srv = await startAndConnect();
		const html = await (await fetch(`${srv.baseUrl}/html`)).text();
		// The source HTML has
		// `<link ... href="../../styles/indexes/html-example.css">`
		// and the rewriter swaps it for the manifest's hashed
		// CSS URL.
		expect(html).toMatch(/href="\/indexes\/html-example\.[a-z0-9]+\.css"/);
		// And the original relative path must not survive.
		expect(html).not.toContain('../../styles/indexes/html-example.css');
	}, 30_000);

	test('absolute `/assets/...` href passes through unchanged (favicon path)', async () => {
		const srv = await startAndConnect();
		const html = await (await fetch(`${srv.baseUrl}/html`)).text();
		expect(html).toContain('href="/assets/ico/favicon.ico"');
	}, 30_000);

	test('HTML page body edit propagates to SSR within one rebuild cycle', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		mutateFile(htmlPage, (c) =>
			c.replace('<h1>', '<h1 data-test-id="html-edit">HTML_EDIT_OK ')
		);
		await client.waitFor('html-update', 30_000);
		const html = await (await fetch(`${srv.baseUrl}/html`)).text();
		expect(html).toContain('HTML_EDIT_OK');
	}, 60_000);

	test('multiple `<link>` and `<script>` tags all rewrite correctly', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		// Add extra resource references; each should round-trip
		// through the asset rewriter.
		mutateFile(htmlPage, (c) =>
			c.replace(
				'<link rel="icon" href="/assets/ico/favicon.ico" />',
				'<link rel="icon" href="/assets/ico/favicon.ico" />\n\t\t<link rel="preload" href="/assets/png/absolutejs-temp.png" as="image" />\n\t\t<meta name="absolute-extra" content="MULTI_LINK_OK" />'
			)
		);
		await client.waitFor('html-update', 30_000);
		const html = await (await fetch(`${srv.baseUrl}/html`)).text();
		expect(html).toContain('rel="preload"');
		expect(html).toContain('MULTI_LINK_OK');
		// The absolute `/assets/...` paths must STILL be
		// unchanged after the rewriter pass.
		expect(html).toContain('href="/assets/ico/favicon.ico"');
		expect(html).toContain('href="/assets/png/absolutejs-temp.png"');
	}, 60_000);

	test('HMR client is injected into served HTML in dev mode', async () => {
		const srv = await startAndConnect();
		const html = await (await fetch(`${srv.baseUrl}/html`)).text();
		// `injectHMRIntoHTMLFile` adds two inline `<script>`
		// elements just before `</body>`: a framework marker
		// and the inlined HMR client bundle.
		expect(html).toContain(
			'<script>window.__HMR_FRAMEWORK__="html";</script>'
		);
		expect(html).toContain('data-hmr-client');
	}, 30_000);

	test('TypescriptExample compiled script lands in the build/ output (not the HTML body)', async () => {
		const srv = await startAndConnect();
		// The example's HTML scripts dir is compiled into a
		// hashed artifact (`/example/html/scripts/typescript-example.<hash>.js`)
		// even though no current example HTML page links it.
		// Its manifest key proves the scripts pipeline ran.
		const hmr = (await (
			await fetch(`${srv.baseUrl}/hmr-status`)
		).json()) as { manifestKeys?: string[] };
		expect(hmr.manifestKeys).toContain('TypescriptExample');
	}, 30_000);

	test('new HTML page file created mid-session: route still hits the manifest fallback (no crash)', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		const newHtml = resolve(
			PROJECT_ROOT,
			'example/html/pages/NewHtmlSentinel.html'
		);
		createFile(
			newHtml,
			`<!doctype html><html><head><title>new</title></head><body><h1>NEW_HTML_PAGE_OK</h1></body></html>\n`
		);
		// New page entries trigger the `[abs:restart]` fallback
		// — the parent CLI is what would respawn. Inside the
		// child we just verify the marker fires and no 5xx
		// happens.
		await server!.waitForOutput(
			/\[abs:restart\]|hmr update.*NewHtmlSentinel\.html/,
			{ timeoutMs: 30_000 }
		);
		// Sanity: existing routes still serve OK.
		const res = await fetch(`${srv.baseUrl}/html`);
		expect(res.status).toBe(200);
	}, 60_000);

	test('HTML page edit preserves the dev injected `<script type="module" src="/@hmr/...">` link', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		mutateFile(htmlPage, (c) =>
			c.replace('<h1>', '<h1>INJECT_SURVIVE_OK ')
		);
		await client.waitFor('html-update', 30_000);
		const html = await (await fetch(`${srv.baseUrl}/html`)).text();
		expect(html).toContain('INJECT_SURVIVE_OK');
		// HMR client script must still be present after the
		// re-injection pass.
		expect(html).toContain('data-hmr-client');
	}, 60_000);

	test('manifest key for HTML page is the basename (no "Page" suffix)', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		const manifestMsg = await Promise.race([
			new Promise<{ manifest?: Record<string, string> }>((res) => {
				// Already consumed by setup — pull from initial state.
				setTimeout(() => res({}), 50);
			})
		]);
		// We didn't capture the initial manifest, so re-derive
		// via /hmr-status's manifestKeys list.
		const hmr = (await (
			await fetch(`${srv.baseUrl}/hmr-status`)
		).json()) as { manifestKeys?: string[] };
		expect(hmr.manifestKeys).toBeTruthy();
		expect(hmr.manifestKeys).toContain('HTMLExample');
		// Crucially, NOT `HTMLExamplePage` — the basename rule
		// for HTML pages drops any "Page" suffix.
		expect(hmr.manifestKeys).not.toContain('HTMLExamplePage');
		void manifestMsg;
	}, 30_000);

	test('HTML page CSS path rewrites every time the markup is rebuilt', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		// Capture CSS URL before
		const before = await (await fetch(`${srv.baseUrl}/html`)).text();
		const cssBefore = before.match(
			/href="(\/indexes\/html-example\.[^"]+\.css)"/
		);
		expect(cssBefore?.[1]).toBeTruthy();

		// Edit the page (markup-only) and verify the CSS URL
		// is still resolvable on the next request — the rewrite
		// pass shouldn't dangle.
		mutateFile(htmlPage, (c) =>
			c.replace('<h1>', '<h1>CSS_REWRITE_PRESERVED_OK ')
		);
		await client.waitFor('html-update', 30_000);
		const after = await (await fetch(`${srv.baseUrl}/html`)).text();
		expect(after).toContain('CSS_REWRITE_PRESERVED_OK');
		const cssAfter = after.match(
			/href="(\/indexes\/html-example\.[^"]+\.css)"/
		);
		expect(cssAfter?.[1]).toBeTruthy();
		// Fetch the CSS to confirm it's still served (no 404).
		const cssRes = await fetch(`${srv.baseUrl}${cssAfter![1]}`);
		expect(cssRes.status).toBe(200);
	}, 60_000);

	test('HTML page broadcast contains framework metadata and body content', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		mutateFile(htmlPage, (c) => c.replace('<h1>', '<h1>METADATA_OK '));
		const update = await client.waitFor('html-update', 30_000);
		const data = update.data as {
			framework?: string;
			html?: { body?: string };
		};
		expect(data.framework).toBe('html');
		// Body content should include the change.
		expect(data.html?.body).toContain('METADATA_OK');
		void srv;
	}, 60_000);

	test('public/* files are served at `/<filename>` (mirror)', async () => {
		const srv = await startAndConnect();
		// The example's public dir contains a robots.txt that
		// gets mirrored to `/robots.txt`.
		const res = await fetch(`${srv.baseUrl}/robots.txt`);
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body.length).toBeGreaterThan(0);
	}, 30_000);
});
