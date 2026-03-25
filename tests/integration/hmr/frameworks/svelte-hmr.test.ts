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

describe('Svelte HMR', () => {
	test('setup: start server and connect', async () => {
		server = await startDevServer();
		client = await connectHMR(server.port);
		await client.waitFor('manifest');
		await client.waitFor('connected');
		client.drain();
	}, 60_000);

	test('svelte page change triggers svelte-update', async () => {
		const sveltePage = resolve(
			PROJECT_ROOT,
			'example/svelte/pages/SvelteExample.svelte'
		);

		mutateFile(sveltePage, (c) =>
			c.replace('AbsoluteJS + Svelte', 'AbsoluteJS + Svelte HMR_TEST')
		);

		await client.waitFor('rebuild-start', 15_000);

		// Fast path sends the framework-specific update directly (no rebuild-complete)
		const update = await client.waitFor('svelte-update', 30_000);
		expect(update.type).toBe('svelte-update');
	}, 60_000);

	test('update message contains framework data', async () => {
		const updates = client.messages.filter(
			(m) => m.type === 'svelte-update'
		);
		expect(updates.length).toBeGreaterThan(0);
		const [first] = updates;
		if (!first) return;
		const data = first.data as Record<string, unknown>;
		expect(data.framework).toBe('svelte');
		expect(data.manifest).toBeDefined();
		expect(data.sourceFile).toBeDefined();
	});

	test('fast path provides pageModuleUrl for unbundled ESM', async () => {
		client.drain();
		await Bun.sleep(1000);

		const sveltePage = resolve(
			PROJECT_ROOT,
			'example/svelte/pages/SvelteExample.svelte'
		);
		mutateFile(sveltePage, (c) =>
			c.replace('AbsoluteJS + Svelte', 'AbsoluteJS + Svelte FAST')
		);

		const update = await client.waitFor('svelte-update', 15_000);
		const data = update.data as Record<string, unknown>;
		expect(data.pageModuleUrl).toBeDefined();
		expect(typeof data.pageModuleUrl).toBe('string');
		expect((data.pageModuleUrl as string).startsWith('/@src/')).toBe(true);
	}, 30_000);

	test('child component change triggers update', async () => {
		client.drain();
		await Bun.sleep(1000);

		const counter = resolve(
			PROJECT_ROOT,
			'example/svelte/components/Counter.svelte'
		);
		mutateFile(counter, (c) => c.replace('count is', 'clicks:'));

		const update = await client.waitFor('svelte-update', 15_000);
		const data = update.data as Record<string, unknown>;
		expect(data.pageModuleUrl).toBeDefined();
	}, 30_000);
});
