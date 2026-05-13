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

/* Mirrors `vue-composable-ssr.test.ts` for Svelte. The shared root
 * cause (#227 / #228) was the persistent compile cache short-
 * circuiting recompiles whose intermediates had been wiped from
 * disk, leaving the next bundle pass unable to resolve sibling
 * `.js` outputs. The compileSvelte disk-presence guard fixed it
 * symmetrically; this test verifies the symptom is gone. */
describe('Svelte composable .svelte.ts edit reaches SSR', () => {
	test('setup', async () => {
		server = await startDevServer();
		client = await connectHMR(server.port);
		await client.waitFor('manifest');
		await client.waitFor('connected');
		client.drain();
	}, 60_000);

	test('editing counter() adjusts count rendered by SSR', async () => {
		const composable = resolve(
			PROJECT_ROOT,
			'example/svelte/composables/counter.svelte.ts'
		);

		client.drain();
		mutateFile(composable, (c) =>
			c.replace(
				'let count = initialCount;',
				'let count = initialCount + 41;'
			)
		);

		await client.waitFor('svelte-tier-zero-ssr-rebuild-complete');
		const html = await (await fetch(`${server.baseUrl}/svelte`)).text();
		expect(html).toContain('count is 41');
	}, 15_000);
});
