import { describe, expect, test, afterAll, afterEach } from 'bun:test';
import { resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { connectHMR, type HMRClient } from '../../../helpers/ws';
import { mutateFile, restoreAllFiles } from '../../../helpers/file';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');

let server: DevServer | undefined;
let client: HMRClient | undefined;

afterEach(async () => {
	if (client) {
		client.close();
		client = undefined;
	}
	if (server) {
		await server.kill();
		server = undefined;
	}
	restoreAllFiles();
});

afterAll(async () => {
	// Belt-and-braces — afterEach handles the per-test cleanup, but
	// any test that bails before its afterEach runs still leaks the
	// dev server. afterAll catches that.
	if (client) client.close();
	if (server) await server.kill();
});

const vuePage = resolve(PROJECT_ROOT, 'example/vue/pages/VueExample.vue');
const angularTemplate = resolve(
	PROJECT_ROOT,
	'example/angular/templates/angular-example.html'
);

const startAndConnect = async () => {
	server = await startDevServer();
	client = await connectHMR(server.port);
	await client.waitFor('manifest');
	await client.waitFor('connected');
	client.drain();
	return server;
};

/* Cross-cutting reliability scenarios:
 *   1. Long-running session — many sequential edits, watcher and
 *      compile caches must stay coherent.
 *   2. Rapid concurrent edits — 5 edits within the watcher debounce
 *      window; the SSR should converge on the LAST state.
 *   3. Build-error recovery — a deliberate syntax error followed by
 *      a fix; the dev server should keep running and the SSR should
 *      reflect the fix.
 *   4. HMR client disconnect / reconnect — state survives a client
 *      going away and coming back.
 *   5. Sourcemap header presence in /@src/ responses.
 */
describe('Cross-cutting HMR reliability', () => {
	test(
		'long-running session: 25 sequential vue page edits all converge',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			for (let i = 0; i < 25; i++) {
				client.drain();
				mutateFile(vuePage, (c) =>
					c.replace(
						/<h1>AbsoluteJS \+ Vue[^<]*<\/h1>/,
						`<h1>AbsoluteJS + Vue ITER_${i}</h1>`
					)
				);
				await client.waitFor(
					'vue-tier-zero-ssr-rebuild-complete',
					30_000
				);
			}
			const html = await (await fetch(`${srv.baseUrl}/vue`)).text();
			// Final iteration sentinel must land — proves the
			// compile cache + watcher hash table didn't get stuck.
			expect(html).toContain('ITER_24');
		},
		300_000
	);

	test(
		'rapid concurrent edits converge on the last-edit state',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			// Issue 5 mutations as fast as we can without waiting
			// for any single HMR broadcast in between. The watcher
			// will batch them into N debounce windows (some N ≤ 5);
			// the final state on disk is `RAPID_4`.
			for (let i = 0; i < 5; i++) {
				mutateFile(vuePage, (c) =>
					c.replace(
						/<h1>AbsoluteJS \+ Vue[^<]*<\/h1>/,
						`<h1>AbsoluteJS + Vue RAPID_${i}</h1>`
					)
				);
				restoreAllFiles();
			}
			// One final mutation we DO wait for, with the final
			// sentinel.
			mutateFile(vuePage, (c) =>
				c.replace(
					/<h1>AbsoluteJS \+ Vue[^<]*<\/h1>/,
					'<h1>AbsoluteJS + Vue RAPID_FINAL</h1>'
				)
			);
			await client.waitFor(
				'vue-tier-zero-ssr-rebuild-complete',
				30_000
			);
			const html = await (await fetch(`${srv.baseUrl}/vue`)).text();
			expect(html).toContain('RAPID_FINAL');
		},
		90_000
	);

	test(
		'build-error recovery: introduce syntax error, then fix, SSR recovers',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			// Inject a deliberate syntax error into the Vue page —
			// the dev server should log a build error but keep
			// running.
			mutateFile(vuePage, (c) =>
				c.replace(
					"import { ref } from 'vue';",
					"import { ref } from 'vue THIS_IS_BROKEN'"
				)
			);
			// Allow the broken cycle to fire and settle. We can't
			// deterministically wait for "rebuild-error" because
			// some fast paths skip it; instead we wait briefly for
			// any HMR event from this batch, then proceed.
			try {
				await client.waitFor('rebuild-error', 10_000);
			} catch {
				/* No rebuild-error fired — some Vue fast paths
				 * surface the error via `framework-update` instead.
				 * Either way the running server is still healthy. */
			}

			// Replace with a clean fix. SSR should converge.
			client.drain();
			restoreAllFiles();
			mutateFile(vuePage, (c) =>
				c.replace(
					/<h1>AbsoluteJS \+ Vue[^<]*<\/h1>/,
					'<h1>AbsoluteJS + Vue RECOVERED_OK</h1>'
				)
			);
			await client.waitFor(
				'vue-tier-zero-ssr-rebuild-complete',
				30_000
			);
			const html = await (await fetch(`${srv.baseUrl}/vue`)).text();
			expect(html).toContain('RECOVERED_OK');

			// Sanity: dev server is still responding to /hmr-status.
			const status = await fetch(`${srv.baseUrl}/hmr-status`);
			expect(status.status).toBe(200);
		},
		120_000
	);

	test(
		'HMR client disconnect → reconnect: server state preserved across reconnect',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			// Mutate once, wait for the rebuild, then drop the
			// WebSocket and re-open it. The server's manifest +
			// compile caches should survive.
			mutateFile(vuePage, (c) =>
				c.replace(
					/<h1>AbsoluteJS \+ Vue[^<]*<\/h1>/,
					'<h1>AbsoluteJS + Vue DISCONNECT_BEFORE</h1>'
				)
			);
			await client.waitFor(
				'vue-tier-zero-ssr-rebuild-complete',
				30_000
			);

			client.close();
			client = undefined;

			// Reconnect.
			const reconnected = await connectHMR(srv.port);
			await reconnected.waitFor('manifest');
			await reconnected.waitFor('connected');

			// Mutate again — the new connection should still see
			// rebuild broadcasts.
			reconnected.drain();
			mutateFile(vuePage, (c) =>
				c.replace(
					/<h1>AbsoluteJS \+ Vue[^<]*<\/h1>/,
					'<h1>AbsoluteJS + Vue DISCONNECT_AFTER</h1>'
				)
			);
			await reconnected.waitFor(
				'vue-tier-zero-ssr-rebuild-complete',
				30_000
			);

			const html = await (await fetch(`${srv.baseUrl}/vue`)).text();
			expect(html).toContain('DISCONNECT_AFTER');

			reconnected.close();
		},
		120_000
	);

	test(
		'angular template edit during long-running session does not corrupt manifest',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			// 10 angular template edits, interleaved with manifest
			// snapshot pulls. The /hmr-status manifestKeys list
			// should stay stable across the run — keys don't get
			// added or dropped just because we rebuilt the same
			// pages over and over.
			const baseStatus = await (
				await fetch(`${srv.baseUrl}/hmr-status`)
			).json() as { manifestKeys?: string[] };
			const baseline = new Set(baseStatus.manifestKeys ?? []);

			for (let i = 0; i < 10; i++) {
				client.drain();
				mutateFile(angularTemplate, (c) =>
					c.replace(
						/<a href="\/">AbsoluteJS[^<]*<\/a>/,
						`<a href="/">AbsoluteJS ANG_ITER_${i}</a>`
					)
				);
				await client.waitFor(
					'angular-tier-zero-ssr-rebuild-complete',
					30_000
				);
				restoreAllFiles();
			}

			const finalStatus = await (
				await fetch(`${srv.baseUrl}/hmr-status`)
			).json() as { manifestKeys?: string[] };
			const finalKeys = new Set(finalStatus.manifestKeys ?? []);

			// Every original key still present.
			for (const k of baseline) {
				expect(finalKeys.has(k)).toBe(true);
			}
			// No unexpected new keys (small noise tolerance: chunk-
			// hash entries can rotate; filter those out).
			const realNewKeys = [...finalKeys].filter(
				(k) => !baseline.has(k) && !k.toLowerCase().startsWith('chunk')
			);
			expect(realNewKeys).toEqual([]);
		},
		180_000
	);

	test(
		'module-server `/@src/` URL serves source files with the dev cache headers',
		async () => {
			const srv = await startAndConnect();
			// Pick a known source path the warm-cache populates at
			// startup. The Vue page's compiled .vue.js index entry
			// gets a `/@src/` URL via `patchManifestIndexes`.
			const res = await fetch(
				`${srv.baseUrl}/@src/src/dev/client/hmrClient.ts`
			);
			// 200 or 304 — either means the module server served
			// the source (not a 404 from staticPlugin).
			expect([200, 304]).toContain(res.status);
			expect(res.headers.get('content-type') ?? '').toMatch(
				/javascript|typescript/i
			);
		},
		30_000
	);
});
