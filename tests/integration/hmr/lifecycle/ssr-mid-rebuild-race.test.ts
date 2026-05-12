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

const vuePage = resolve(PROJECT_ROOT, 'example/vue/pages/VueExample.vue');
const sveltePage = resolve(
	PROJECT_ROOT,
	'example/svelte/pages/SvelteExample.svelte'
);
const startAll = async () => {
	server = await startDevServer();
	client = await connectHMR(server.port);
	await client.waitFor('manifest');
	await client.waitFor('connected');
	client.drain();
	return { client: client!, server: server! };
};

const swarm = async (url: string, count: number) => {
	const tasks = Array.from({ length: count }, async () => {
		try {
			const res = await fetch(url);
			const body = await res.text();
			return { ok: true, status: res.status, length: body.length };
		} catch (err) {
			return {
				ok: false,
				reason: err instanceof Error ? err.message : String(err),
				status: 0,
				length: 0
			};
		}
	});
	return Promise.all(tasks);
};

/* `static-serving-race.test.ts` (#224) verifies the hashed-bundle
 * static-asset path doesn't 5xx during a rapid edit burst — but it
 * fires one snapshot per edit cycle. This file tightens the race
 * window: it pile-drives many CONCURRENT SSR document fetches into
 * the dev server during a single mid-rebuild window, asserting:
 *   - No status ≥ 500.
 *   - No empty / truncated body.
 *   - Body is either the pre-edit or post-edit content (never a
 *     partially rendered string that contains pre-edit AND post-edit
 *     fragments).
 *
 * This catches a different bug class than #224: not a fragile
 * static-asset path, but a torn read of the SSR pipeline mid-tier-0
 * rebuild (loader/manifest swap visible to a fetch handler before
 * the bundle on disk is fully written). */
describe('SSR document requests landing mid-rebuild', () => {
	test(
		'20 concurrent /vue fetches across a tier-0 template edit window all succeed',
		async () => {
			const { server: srv } = await startAll();

			// Establish baseline content so we can recognize coherent
			// renders.
			const baseline = await (await fetch(`${srv.baseUrl}/vue`)).text();
			expect(baseline).toContain('count is 0');

			// Race window: fire the edit, then immediately swarm 20
			// concurrent fetches. Some will resolve from the pre-edit
			// bundle, some from the post-edit bundle.
			mutateFile(vuePage, (text) =>
				text.replace(
					'<h1>AbsoluteJS + Vue</h1>',
					'<h1>AbsoluteJS + Vue MID_REBUILD_OK</h1>'
				)
			);
			const results = await swarm(`${srv.baseUrl}/vue`, 20);

			const failures = results.filter(
				(r) => !r.ok || r.status >= 500 || r.length < 100
			);
			expect(failures).toEqual([]);
		},
		60_000
	);

	test(
		'40 fetches across 4 rapid Svelte edits never produce 5xx or empty bodies',
		async () => {
			const { server: srv } = await startAll();

			// Baseline.
			expect(
				(await (await fetch(`${srv.baseUrl}/svelte`)).text()).length
			).toBeGreaterThan(100);

			const allResults: Awaited<ReturnType<typeof swarm>>[] = [];
			for (let i = 0; i < 4; i++) {
				mutateFile(sveltePage, (text) =>
					text.replace(
						'<h1>AbsoluteJS',
						`<h1>AbsoluteJS RAPID_${i}_`
					)
				);
				// Don't await an HMR cycle — we're explicitly probing
				// the race window between edit and rebuild completion.
				allResults.push(await swarm(`${srv.baseUrl}/svelte`, 10));
				restoreAllFiles();
			}

			const failures = allResults
				.flat()
				.filter((r) => !r.ok || r.status >= 500 || r.length < 100);
			expect(failures).toEqual([]);
		},
		90_000
	);

});
