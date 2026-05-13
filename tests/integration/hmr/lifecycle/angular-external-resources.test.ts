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

const counterComponent = resolve(
	PROJECT_ROOT,
	'example/angular/components/counter.component.ts'
);
const counterStyle = resolve(
	PROJECT_ROOT,
	'example/styles/counter.component.css'
);
const appStyle = resolve(PROJECT_ROOT, 'example/styles/app.component.css');

const startAndConnect = async () => {
	server = await startDevServer();
	client = await connectHMR(server.port);
	await client.waitFor('manifest');
	await client.waitFor('connected');
	client.drain();
	return server;
};

const waitForBundleAndFetch = async (
	c: HMRClient,
	srv: DevServer,
	url = '/angular'
) => {
	await c.waitFor('angular-tier-zero-ssr-rebuild-complete', 30_000);
	return (await fetch(`${srv.baseUrl}${url}`)).text();
};

/* Angular components pull external `templateUrl` / `styleUrl` /
 * `styleUrls` files in at compile time — `compileAngularFileJIT`'s
 * `inlineResources` step reads them off disk and bakes the bytes
 * directly into the emitted component metadata. Editing a resource
 * file alone is what `runAngularHmrIncremental`'s
 * `resolveOwningComponents` flow maps back to the .ts file that
 * owns it, so the HMR pipeline can pick the right tier even for
 * pure resource edits.
 *
 * Each test edits one resource shape and asserts the new bytes
 * land in the SSR HTML's inlined style/template content. */
describe('Angular external resource edits', () => {
	test('`styleUrl` (.css) edit reaches SSR inlined `<style ng-app-id>` block', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		mutateFile(counterStyle, (c) =>
			c.replace(
				'background-color: #1a1a1a;',
				'background-color: #ff44aa;'
			)
		);

		const html = await waitForBundleAndFetch(client, srv);
		// Angular SSR emits styles into `<style ng-app-id="ng">`
		// blocks (one per component scope). The non-compressible
		// hex codes (3 distinct chars per pair) survive Bun's CSS
		// minifier verbatim.
		expect(html).toContain('#ff44aa');
	}, 60_000);

	test('`@import` chain inside a `styleUrl` propagates the leaf change', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		const leafStyle = resolve(
			PROJECT_ROOT,
			'example/styles/counter.imported.css'
		);
		createFile(leafStyle, `.counter-value { color: #aa44ff; }\n`);
		mutateFile(
			counterStyle,
			(c) => `@import "./counter.imported.css";\n${c}`
		);

		const html = await waitForBundleAndFetch(client, srv);
		// The imported leaf rule should be hoisted into the
		// component's inlined `<style>` block after `inlineResources`
		// walks the @import chain.
		expect(html).toContain('#aa44ff');
	}, 60_000);

	test('`styleUrl` deep edit (cascade-affecting selector) reaches SSR', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		// Add a selector that targets the `.counter-value` span
		// directly — different from the bare `button {…}` rule.
		// The change forces a recompile of just the .css file,
		// and the corresponding .ts component re-emits to disk.
		mutateFile(
			counterStyle,
			(c) =>
				`${c}\n.counter-value { background-color: #11aa55; font-weight: 900; }\n`
		);

		const html = await waitForBundleAndFetch(client, srv);
		expect(html).toContain('#11aa55');
	}, 60_000);

	test('`encapsulation: None` style edit propagates without `_ngcontent` rewrites', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		// AppComponent has `encapsulation: ViewEncapsulation.None`,
		// so its styleUrl content is emitted globally — no
		// `[_ngcontent-…]` attribute selectors. The edit should
		// still propagate but the inlined block lacks the per-
		// component shadow attribute.
		mutateFile(
			appStyle,
			(c) =>
				`${c}\n.encapsulation-none-marker { background-color: #66aaff; }\n`
		);

		const html = await waitForBundleAndFetch(client, srv);
		expect(html).toContain('#66aaff');
		// Selector should appear as a plain class (no scope attr).
		const blockStart = html.indexOf('.encapsulation-none-marker');
		expect(blockStart).toBeGreaterThan(-1);
		const blockSlice = html.slice(blockStart, blockStart + 80);
		expect(blockSlice).not.toMatch(/\[_ngcontent-/);
	}, 60_000);

	test('inline `styles: [...]` array edit reaches SSR', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		// Replace `styleUrl: '...'` with an inline `styles: [...]`
		// array so `compileAngularFileJIT` doesn't read from disk
		// at all — the bytes come from the .ts source.
		mutateFile(counterComponent, (c) =>
			c.replace(
				"styleUrl: '../../styles/counter.component.css',",
				"styles: [':host { color: #aabb33; } button { color: #aabb33; }'],"
			)
		);

		const html = await waitForBundleAndFetch(client, srv);
		expect(html).toContain('#aabb33');
	}, 60_000);
});
