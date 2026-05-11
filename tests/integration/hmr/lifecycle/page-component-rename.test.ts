import { describe, expect, test, afterAll, afterEach } from 'bun:test';
import { resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { connectHMR, type HMRClient } from '../../../helpers/ws';
import {
	mutateFile,
	renameFile,
	restoreAllFiles
} from '../../../helpers/file';

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

/* Renaming a non-entry component plus updating its importer in
 * the same edit batch must produce a working SSR — the dep graph
 * has to drop the old node and pick up the new one, and the
 * compile cache for the renamed component must not shadow the
 * fresh path. Failure modes the test catches:
 *
 *   - Importer still references the old (now-deleted) path
 *     → SSR throws a module-resolution error.
 *   - Compile cache short-circuits the new path because the new
 *     file's content hash matches a cached entry from the old
 *     path (the persistent cache disk-check from #228 fixed
 *     this for the inverse case; this test exercises the path
 *     where the cache key *is* the new path).
 *   - Manifest still points at a stale generated path for the
 *     entry that depended on the renamed component. */
describe('Page rename + import update → page recovers', () => {
	test('setup', async () => {
		server = await startDevServer();
		client = await connectHMR(server.port);
		await client.waitFor('manifest');
		await client.waitFor('connected');
		client.drain();
	}, 60_000);

	test(
		'renaming Counter.svelte → CounterRenamed.svelte and updating the import keeps /svelte rendering',
		async () => {
			const oldComponent = resolve(
				PROJECT_ROOT,
				'example/svelte/components/Counter.svelte'
			);
			const newComponent = resolve(
				PROJECT_ROOT,
				'example/svelte/components/CounterRenamed.svelte'
			);
			const page = resolve(
				PROJECT_ROOT,
				'example/svelte/pages/SvelteExample.svelte'
			);

			client.drain();
			renameFile(oldComponent, newComponent);
			mutateFile(page, (c) =>
				c
					.replace(
						"import Counter from '../components/Counter.svelte';",
						"import Counter from '../components/CounterRenamed.svelte';"
					)
					.replace(
						'<Counter {initialCount} />',
						'<Counter {initialCount} /><span data-renamed-rendered="true">RENAME_OK</span>'
					)
			);

			await client.waitFor('svelte-tier-zero-ssr-rebuild-complete');
			const html = await (await fetch(`${server.baseUrl}/svelte`)).text();
			// Two assertions: (a) the page rendered at all (no
			// module-not-found from the dangling import), and
			// (b) the renamed component's compiled output is what
			// SSR loaded (the sentinel proves the import is wired).
			expect(html).toContain('RENAME_OK');
			expect(html).toContain('count is 0');
		},
		20_000
	);
});
