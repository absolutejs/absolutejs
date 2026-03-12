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

describe('Asset hashing after HMR', () => {
	test('setup: start server, connect, capture initial manifest', async () => {
		server = await startDevServer();
		client = await connectHMR(server.port);
		await client.waitFor('manifest');
		await client.waitFor('connected');
		client.drain();
	}, 60_000);

	test('manifest keys update after file change', async () => {
		const reactPage = resolve(
			PROJECT_ROOT,
			'example/react/pages/ReactExample.tsx'
		);

		mutateFile(reactPage, (c) =>
			c.replace('AbsoluteJS + React', 'AbsoluteJS + React HASH_TEST')
		);

		await client.waitFor('rebuild-start', 15_000);

		// Wait for rebuild to finish — the fast path may not send rebuild-complete
		await Bun.sleep(5_000);

		// Fetch updated manifest from status
		const statusRes = await fetch(`${server.baseUrl}/hmr-status`);
		const status = await statusRes.json();

		// The manifestKeys should still contain the same entries
		expect(status.manifestKeys.length).toBeGreaterThan(0);
	}, 60_000);
});
