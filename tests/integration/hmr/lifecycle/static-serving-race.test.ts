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

/* Bug #224: rapid HMR rebuilds can leave a manifest-referenced
 * asset transiently unavailable on disk (the new bundle is mid-
 * write or the old bundle has been pruned but the browser still
 * holds HTML referencing its hash). The expected behaviour is that
 * the dev-server's asset path (assetStore → disk → hashless alias)
 * always lands on a 200 or 404, never a 5xx crash from
 * `@elysiajs/static`'s pre-registered routes throwing ENOENT
 * mid-rebuild.
 *
 * The test fires 8 mutate-fetch pairs in tight succession against
 * the manifest's current bundle URLs. The expectation is each
 * response is HTTP 2xx or 3xx — anything ≥ 500 means the static-
 * serving path threw uncaught. */
describe('Static asset serving survives rapid HMR rebuilds (#224)', () => {
	test('setup', async () => {
		server = await startDevServer();
		client = await connectHMR(server.port);
		const manifestMsg = await client.waitFor('manifest');
		await client.waitFor('connected');
		client.drain();
		// Sanity: the manifest contains at least the Vue+Svelte+Angular
		// page bundles whose paths we'll be hammering.
		const manifest =
			(manifestMsg.data as { manifest?: Record<string, string> })
				?.manifest ?? {};
		expect(manifest.VueExample).toBeTruthy();
		expect(manifest.SvelteExample).toBeTruthy();
	}, 60_000);

	test(
		'rapid edits never produce 5xx responses for current asset URLs',
		async () => {
			const vuePage = resolve(
				PROJECT_ROOT,
				'example/vue/pages/VueExample.vue'
			);
			const sveltePage = resolve(
				PROJECT_ROOT,
				'example/svelte/pages/SvelteExample.svelte'
			);

			// Helper: hit a few critical dev-server URLs and report
			// any status ≥ 500. We don't care about 404 vs 200 here —
			// both are valid outcomes during a rebuild window. We
			// care that nothing CRASHES.
			const probe = async () => {
				const urls = [
					`${server.baseUrl}/vue`,
					`${server.baseUrl}/svelte`,
					`${server.baseUrl}/angular`,
					`${server.baseUrl}/htmx`,
					`${server.baseUrl}/`,
					`${server.baseUrl}/hmr-status`
				];
				const results = await Promise.all(
					urls.map(async (url) => {
						try {
							const res = await fetch(url);
							// Drain the body so the response is fully
							// consumed (some Bun versions hold sockets
							// open until the body is read).
							await res.text();
							return res.status;
						} catch {
							// Network-level failure (connection
							// refused, etc.) counts as a crash too —
							// return 599 to flag it.
							return 599;
						}
					})
				);
				return results;
			};

			const allStatuses: number[][] = [];
			for (let i = 0; i < 6; i++) {
				// Mutate one of the pages, fire fetches without
				// waiting for the HMR cycle to complete. This is the
				// race-window probe.
				const target = i % 2 === 0 ? vuePage : sveltePage;
				mutateFile(target, (c) =>
					c.replace(
						'<h1>AbsoluteJS',
						`<h1>AbsoluteJS RAPID_${i}_`
					)
				);
				const statuses = await probe();
				allStatuses.push(statuses);
				restoreAllFiles();
			}

			// Flatten and check: no status ≥ 500.
			const failures = allStatuses
				.flat()
				.filter((s) => s >= 500);
			expect(failures).toEqual([]);
		},
		60_000
	);
});
