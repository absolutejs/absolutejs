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

describe('Multi-framework simultaneous changes', () => {
	test('setup: start server and connect', async () => {
		server = await startDevServer();
		client = await connectHMR(server.port);
		await client.waitFor('manifest');
		await client.waitFor('connected');
		client.drain();
	}, 60_000);

	test('simultaneous changes to two frameworks triggers fast paths', async () => {
		const reactPage = resolve(
			PROJECT_ROOT,
			'example/react/pages/ReactExample.tsx'
		);
		const sveltePage = resolve(
			PROJECT_ROOT,
			'example/svelte/pages/SvelteExample.svelte'
		);

		mutateFile(reactPage, (c) =>
			c.replace('AbsoluteJS + React', 'AbsoluteJS + React MULTI')
		);
		mutateFile(sveltePage, (c) =>
			c.replace('AbsoluteJS + Svelte', 'AbsoluteJS + Svelte MULTI')
		);

		// Each framework's fast path sends its own update message
		const reactUpdate = await client.waitFor('react-update', 15_000);
		expect(reactUpdate.type).toBe('react-update');

		const svelteUpdate = await client.waitFor('svelte-update', 15_000);
		expect(svelteUpdate.type).toBe('svelte-update');
	}, 60_000);

	test('server health after multi-framework change', async () => {
		// With fast batch delays, drainPendingQueue may trigger a follow-up
		// rebuild after the first completes — poll until the server settles.
		let status: { isRebuilding: boolean } = { isRebuilding: true };
		for (let i = 0; i < 20 && status.isRebuilding; i++) {
			await Bun.sleep(500);
			const res = await fetch(`${server.baseUrl}/hmr-status`);
			expect(res.ok).toBe(true);
			status = (await res.json()) as { isRebuilding: boolean };
		}
		expect(status.isRebuilding).toBe(false);
	}, 60_000);
});
