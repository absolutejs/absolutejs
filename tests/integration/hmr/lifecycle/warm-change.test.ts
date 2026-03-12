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

describe('HMR warm change (second+ edits)', () => {
	test('setup: start server, connect, and do initial change', async () => {
		server = await startDevServer();
		client = await connectHMR(server.port);
		await client.waitFor('manifest');
		await client.waitFor('connected');
		client.drain();

		// First change to warm the cache
		const svelteFile = resolve(
			PROJECT_ROOT,
			'example/svelte/pages/SvelteExample.svelte'
		);
		mutateFile(svelteFile, (c) =>
			c.replace('AbsoluteJS + Svelte', 'AbsoluteJS + Svelte WARM1')
		);
		await client.waitFor('rebuild-start', 15_000);
		await client.waitFor('svelte-update', 30_000);
		client.drain();
		restoreAllFiles();
	}, 60_000);

	test('second change rebuilds with warm cache', async () => {
		const svelteFile = resolve(
			PROJECT_ROOT,
			'example/svelte/pages/SvelteExample.svelte'
		);

		const warmStart = performance.now();

		mutateFile(svelteFile, (c) =>
			c.replace('AbsoluteJS + Svelte', 'AbsoluteJS + Svelte WARM2')
		);

		await client.waitFor('rebuild-start', 15_000);
		const update = await client.waitFor('svelte-update', 30_000);
		const warmDuration = performance.now() - warmStart;

		expect(update.type).toBe('svelte-update');
		expect(warmDuration).toBeGreaterThan(0);
	}, 60_000);

	test('third consecutive change also works', async () => {
		restoreAllFiles();
		client.drain();

		const vueFile = resolve(
			PROJECT_ROOT,
			'example/vue/pages/VueExample.vue'
		);

		mutateFile(vueFile, (c) =>
			c.replace('AbsoluteJS + Vue', 'AbsoluteJS + Vue WARM3')
		);

		await client.waitFor('rebuild-start', 15_000);
		await client.waitFor('vue-update', 30_000);

		const res = await fetch(`${server.baseUrl}/vue`);
		expect(res.ok).toBe(true);
	}, 60_000);
});
