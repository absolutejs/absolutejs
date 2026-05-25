import { describe, expect, test, afterEach } from 'bun:test';
import { resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { connectHMR, type HMRClient } from '../../../helpers/ws';
import { mutateFile, restoreAllFiles } from '../../../helpers/file';

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

const pageComponent = resolve(
	PROJECT_ROOT,
	'example/angular/pages/angular-example.ts'
);
const counterComponent = resolve(
	PROJECT_ROOT,
	'example/angular/components/counter.component.ts'
);

/* Returns { server, client, initialManifest } where initialManifest
 * is the manifest snapshot the dev server pushed in its first
 * `manifest` WebSocket frame. */
const startAndConnect = async () => {
	server = await startDevServer();
	client = await connectHMR(server.port);
	const manifestMsg = await client.waitFor('manifest');
	const initialManifest =
		(manifestMsg.data as { manifest?: Record<string, string> })?.manifest ??
		{};
	await client.waitFor('connected');
	client.drain();

	return { client, initialManifest, server };
};

const waitForBundleAndFetch = async (
	c: HMRClient,
	srv: DevServer,
	url = '/angular'
) => {
	await c.waitFor('angular-tier-zero-ssr-rebuild-complete', 30_000);

	return (await fetch(`${srv.baseUrl}${url}`)).text();
};

/* Angular's SSR path has framework-specific plumbing that diverges
 * from the client bundle:
 *
 *   - When `getAngularServerVendorPaths()` resolves, the compiled
 *     server-side `.js` is copied to a `.ssr.js` sibling and the
 *     vendor specifiers (`@angular/core`, etc.) are rewritten to
 *     point at the bun-target build of `@angular/*`. The manifest
 *     entry points at `.ssr.js`. The client bundle keeps the bare
 *     specifier so it can be inlined against the browser-target
 *     vendor.
 *
 *   - Components that import from `@angular/animations` set
 *     `__ABSOLUTE_PAGE_USES_LEGACY_ANIMATIONS__ = true` on the
 *     emitted page module so the runtime can opt in to the legacy
 *     animations bootstrap.
 *
 *   - SSR HTML carries Angular's hydration markers: `<!--nghm-->`,
 *     `ng-version="…"`, `ng-server-context="…"`, `ngh="…"` per
 *     hydratable element, and a `<script id="ng-state">` blob.
 *
 * Each test asserts one of these contracts. */
describe('Angular vendor / SSR specifics', () => {
	test('baseline SSR HTML carries the standard Angular hydration markers', async () => {
		const { server: srv } = await startAndConnect();
		const html = await (await fetch(`${srv.baseUrl}/angular`)).text();
		expect(html).toContain('<!--nghm-->');
		expect(html).toMatch(/ng-version="\d+\.\d+\.\d+"/);
		expect(html).toMatch(/ng-server-context="[^"]+"/);
		expect(html).toMatch(/ngh="[^"]+"/);
		expect(html).toContain('<script id="ng-state"');
	}, 30_000);

	test('manifest exposes AngularExample page entry (either `.ssr.js` or `.js`)', async () => {
		const { initialManifest } = await startAndConnect();
		const pagePath = initialManifest.AngularExample;
		expect(pagePath).toBeTruthy();
		// `.ssr.js` when vendor rewrites are active, plain `.js`
		// otherwise — both are valid outcomes of
		// `compileAndBundleAngular`'s vendor-rewrite branch.
		expect(pagePath).toMatch(/\.(ssr\.js|js)$/);
		// Index + CSS manifest entries are required for SSR
		// boot.
		expect(initialManifest.AngularExampleIndex).toBeTruthy();
		expect(initialManifest.AngularExampleCSS).toBeTruthy();
	}, 30_000);

	test('editing a component template re-emits a fresh bundle and SSR reflects it', async () => {
		const { client: c, server: srv } = await startAndConnect();

		// Edit the *template* — that change can't be shadowed by
		// ngOnInit the way a field initializer can.
		const counterTemplate = resolve(
			PROJECT_ROOT,
			'example/angular/templates/counter.component.html'
		);
		mutateFile(counterTemplate, (c) =>
			c.replace('count is', 'VENDOR_SSR_SENTINEL')
		);
		await waitForBundleAndFetch(c, srv);

		// After the bundle rebuild, the SSR response should
		// reflect the new template content. The mtime cacheBuster
		// in `pageHandler.ts` busts Bun's import cache so
		// `await import(pagePath)` re-reads from disk.
		const html = await (await fetch(`${srv.baseUrl}/angular`)).text();
		expect(html).toContain('VENDOR_SSR_SENTINEL');
	}, 60_000);

	test('`__ABSOLUTE_PAGE_USES_LEGACY_ANIMATIONS__` is set when the page imports `@angular/animations`', async () => {
		const { client: c, server: srv } = await startAndConnect();

		mutateFile(pageComponent, (c) =>
			c.replace(
				"import { Component } from '@angular/core';",
				"import { Component } from '@angular/core';\nimport { trigger } from '@angular/animations';\nconst _unusedTrigger = trigger;"
			)
		);

		await waitForBundleAndFetch(c, srv);

		const { readFileSync } = await import('node:fs');
		const generatedPage = resolve(
			PROJECT_ROOT,
			'.absolutejs/generated/angular/pages/angular-example.js'
		);
		const emitted = readFileSync(generatedPage, 'utf-8');
		expect(emitted).toContain(
			'__ABSOLUTE_PAGE_USES_LEGACY_ANIMATIONS__ = true'
		);
	}, 60_000);

	test('SSR HTML imports the page index bundle URL from the manifest', async () => {
		const { initialManifest, server: srv } = await startAndConnect();
		const indexPath = initialManifest.AngularExampleIndex;
		expect(indexPath).toBeTruthy();

		const html = await (await fetch(`${srv.baseUrl}/angular`)).text();
		// The handler appends a `<script>import("...")</script>`
		// at the end of <body> for client hydration. The URL is
		// the manifest's index entry.
		expect(html).toContain(indexPath!);
	}, 30_000);
});
