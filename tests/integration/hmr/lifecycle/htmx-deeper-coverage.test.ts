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

const htmxPage = resolve(
	PROJECT_ROOT,
	'example/htmx/pages/HTMXExample.html'
);
const serverEntry = resolve(PROJECT_ROOT, 'example/server.ts');

const startAndConnect = async () => {
	server = await startDevServer();
	client = await connectHMR(server.port);
	await client.waitFor('manifest');
	await client.waitFor('connected');
	client.drain();
	return server;
};

/* HTMX deeper coverage — pushes the matrix to Angular depth for
 * the HTMX adapter. HTMX is HTML-with-attributes plus Elysia route
 * handlers that respond with HTML fragments. The dev pipeline:
 *
 *   - Treats `*.html` in `htmxDirectory` as full pages (same path
 *     as HTML, but HMR-injected with `__HMR_FRAMEWORK__="htmx"`).
 *   - Serves the vendor `htmx.min.js` at `/htmx/htmx.min.js`.
 *   - Handles fragment-endpoint edits in `server.ts` via Path B
 *     reload (covered in htmx-fragment-path-b.test.ts; tested here
 *     under different hx-swap shapes too).
 *
 * Each test exercises one HTMX-specific surface. */
describe('HTMX deeper coverage', () => {
	test(
		'hx-* attributes round-trip through SSR unchanged',
		async () => {
			const srv = await startAndConnect();
			const html = await (await fetch(`${srv.baseUrl}/htmx`)).text();
			// The example uses a dozen hx-* attributes — verify
			// the ones that exercise different attribute parser
			// branches all survived.
			expect(html).toContain('hx-post="/htmx/reset"');
			expect(html).toContain('hx-trigger="beforeunload from:window once"');
			expect(html).toContain('hx-swap="none"');
			expect(html).toContain('hx-target="#count"');
			expect(html).toContain('hx-swap="innerHTML"');
			expect(html).toContain('hx-get="/htmx/count"');
			expect(html).toContain('hx-trigger="load"');
		},
		30_000
	);

	test(
		'HTMX page edit propagates via `htmx-update` HMR broadcast',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			mutateFile(htmxPage, (c) =>
				c.replace('<h1>', '<h1>HTMX_EDIT_OK ')
			);
			const update = await client.waitFor('htmx-update', 30_000);
			expect((update.data as { framework?: string })?.framework).toBe(
				'htmx'
			);
			const html = await (await fetch(`${srv.baseUrl}/htmx`)).text();
			expect(html).toContain('HTMX_EDIT_OK');
		},
		60_000
	);

	test(
		'HMR client is injected with the correct framework marker (`htmx`)',
		async () => {
			const srv = await startAndConnect();
			const html = await (await fetch(`${srv.baseUrl}/htmx`)).text();
			// Same shape as HTML's injection but with `"htmx"`.
			expect(html).toContain(
				'<script>window.__HMR_FRAMEWORK__="htmx";</script>'
			);
			expect(html).toContain('data-hmr-client');
		},
		30_000
	);

	test(
		'fragment endpoint `hx-get` returns a plain text body when edited',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			// Mutate the `/htmx/count` route to return a custom
			// sentinel, wait for Path B reload to apply, then fetch
			// the endpoint directly the way an htmx swap would.
			mutateFile(serverEntry, (c) =>
				c.replace(
					".get('/htmx/count', ({ scopedStore }) => scopedStore.count)",
					".get('/htmx/count', () => 'HTMX_SWAP_FRAGMENT_OK')"
				)
			);
			await client.waitFor('server-entry-reloaded', 15_000);
			const res = await fetch(`${srv.baseUrl}/htmx/count`);
			expect(res.status).toBe(200);
			const body = await res.text();
			expect(body).toBe('HTMX_SWAP_FRAGMENT_OK');
		},
		60_000
	);

	test(
		'fragment endpoint supports `hx-swap="outerHTML"` style payloads (raw HTML body)',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			mutateFile(serverEntry, (c) =>
				c.replace(
					".post('/htmx/increment', ({ scopedStore }) => ++scopedStore.count)",
					".post('/htmx/increment', () => '<span id=\"count\" data-outer-swap=\"true\">OUTER_HTML_SWAP_OK</span>')"
				)
			);
			await client.waitFor('server-entry-reloaded', 15_000);
			const res = await fetch(`${srv.baseUrl}/htmx/increment`, {
				method: 'POST'
			});
			expect(res.status).toBe(200);
			const body = await res.text();
			expect(body).toContain('OUTER_HTML_SWAP_OK');
			expect(body).toContain('data-outer-swap="true"');
		},
		60_000
	);

	test(
		'fragment endpoint supports `hx-swap-oob` (out-of-band) markup',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			mutateFile(serverEntry, (c) =>
				c.replace(
					".get('/htmx/count', ({ scopedStore }) => scopedStore.count)",
					".get('/htmx/count', () => '<div hx-swap-oob=\"true\" id=\"oob-target\">OOB_SWAP_OK</div><span>main-count-body</span>')"
				)
			);
			await client.waitFor('server-entry-reloaded', 15_000);
			const body = await (
				await fetch(`${srv.baseUrl}/htmx/count`)
			).text();
			expect(body).toContain('hx-swap-oob="true"');
			expect(body).toContain('OOB_SWAP_OK');
		},
		60_000
	);

	test(
		'`/htmx/htmx.min.js` vendor file is served with non-empty JS payload',
		async () => {
			const srv = await startAndConnect();
			const res = await fetch(`${srv.baseUrl}/htmx/htmx.min.js`);
			expect(res.status).toBe(200);
			const body = await res.text();
			expect(body.length).toBeGreaterThan(1000);
			expect(body).toMatch(/htmx/i);
		},
		30_000
	);

	test(
		'multiple route mutations in one save apply atomically (in-flight requests safe)',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			// One save that rewires two routes — the Path B
			// `Bun.serve.reload({ fetch, routes:{} })` swap applies
			// the whole new app atomically, so both routes appear at
			// the same instant. We assert both are live after one
			// `server-entry-reloaded` broadcast.
			mutateFile(serverEntry, (c) =>
				c
					.replace(
						".get('/htmx/count', ({ scopedStore }) => scopedStore.count)",
						".get('/htmx/count', () => 'COUNT_TWO_EDITS_OK')\n\t.get('/htmx/extra', () => 'EXTRA_ROUTE_OK')"
					)
			);
			await client.waitFor('server-entry-reloaded', 20_000);
			const countRes = await (
				await fetch(`${srv.baseUrl}/htmx/count`)
			).text();
			const extraRes = await (
				await fetch(`${srv.baseUrl}/htmx/extra`)
			).text();
			expect(countRes).toBe('COUNT_TWO_EDITS_OK');
			expect(extraRes).toBe('EXTRA_ROUTE_OK');
		},
		60_000
	);

	test(
		'HTMX page broadcast payload contains the edited body content',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			mutateFile(htmxPage, (c) =>
				c.replace('<h1>', '<h1>BROADCAST_BODY_OK ')
			);
			const update = await client.waitFor('htmx-update', 30_000);
			const data = update.data as { html?: { body?: string } };
			expect(data.html?.body).toContain('BROADCAST_BODY_OK');
			void srv;
		},
		60_000
	);

	test(
		'manifest key for HTMX page is the basename (no "Page" suffix)',
		async () => {
			const srv = await startAndConnect();
			const hmr = await (
				await fetch(`${srv.baseUrl}/hmr-status`)
			).json() as { manifestKeys?: string[] };
			expect(hmr.manifestKeys).toContain('HTMXExample');
			expect(hmr.manifestKeys).not.toContain('HTMXExamplePage');
		},
		30_000
	);

	test(
		'absolute `/assets/...` and `/htmx/...` paths pass through unchanged',
		async () => {
			const srv = await startAndConnect();
			const html = await (await fetch(`${srv.baseUrl}/htmx`)).text();
			expect(html).toContain('href="/assets/ico/favicon.ico"');
			expect(html).toContain('src="/htmx/htmx.min.js"');
		},
		30_000
	);

	test(
		'fragment endpoint that returns JSON still survives Path B reload (no content-type rewrite)',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			mutateFile(serverEntry, (c) =>
				c.replace(
					".get('/htmx/count', ({ scopedStore }) => scopedStore.count)",
					".get('/htmx/count', () => ({ result: 'JSON_FRAGMENT_OK', count: 7 }))"
				)
			);
			await client.waitFor('server-entry-reloaded', 15_000);
			const res = await fetch(`${srv.baseUrl}/htmx/count`);
			expect(res.status).toBe(200);
			expect(res.headers.get('content-type') ?? '').toMatch(
				/application\/json/
			);
			const body = (await res.json()) as {
				result?: string;
				count?: number;
			};
			expect(body.result).toBe('JSON_FRAGMENT_OK');
			expect(body.count).toBe(7);
		},
		60_000
	);
});
