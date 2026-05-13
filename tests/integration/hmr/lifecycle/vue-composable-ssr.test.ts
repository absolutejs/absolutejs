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

/* Verifies that editing a plain `.ts` composable that lives under
 * the Vue framework root propagates through to the SSR output for
 * pages that transitively import it. Pre-fix (#227), the dep-graph
 * walker found the importing `.vue` file but the persistent compile
 * cache short-circuited the recompile of unchanged sibling SFCs and
 * never rewrote their intermediates to disk — so the subsequent
 * `Bun.build` of the page entry tripped `Could not resolve` on a
 * stale-but-missing path. The fix is the disk-presence check
 * inside the compileVue persistent cache. */
describe('Vue composable .ts edit reaches SSR', () => {
	test('setup', async () => {
		server = await startDevServer();
		client = await connectHMR(server.port);
		await client.waitFor('manifest');
		await client.waitFor('connected');
		client.drain();
	}, 60_000);

	test('editing useCount adjusts count rendered by SSR', async () => {
		const composable = resolve(
			PROJECT_ROOT,
			'example/vue/composables/useCount.ts'
		);

		client.drain();
		mutateFile(composable, (c) =>
			c.replace(
				'const count = ref(initialCount);',
				'const count = ref(initialCount + 41);'
			)
		);

		await client.waitFor('vue-tier-zero-ssr-rebuild-complete');
		const html = await (await fetch(`${server.baseUrl}/vue`)).text();
		// initialCount is 0 in example/server.ts; with +41 the rendered
		// button text becomes "count is 41" — and that's what SSR
		// should show on a fresh fetch.
		expect(html).toContain('count is 41');
	}, 15_000);
});
