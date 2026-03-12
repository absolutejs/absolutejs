import { describe, expect, test, afterAll } from 'bun:test';
import { resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { connectHMR, type HMRClient } from '../../../helpers/ws';
import { mutateFile, restoreAllFiles } from '../../../helpers/file';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');

let server: DevServer;
let client: HMRClient;

afterAll(async () => {
	restoreAllFiles();
	client?.close();
	await server?.kill();
});

describe('HMR error recovery', () => {
	test('setup: start server and connect', async () => {
		server = await startDevServer();
		client = await connectHMR(server.port);
		await client.waitFor('manifest');
		await client.waitFor('connected');
		client.drain();
	}, 60_000);

	test('invalid markup triggers rebuild and server survives', async () => {
		const reactPage = resolve(
			PROJECT_ROOT,
			'example/react/pages/ReactExample.tsx'
		);

		// Introduce invalid JSX (extra closing tag)
		mutateFile(reactPage, (c) => c.replace('</main>', '</div></main>'));

		// Wait for file watcher to detect the change
		await Bun.sleep(500);
		await client.waitFor('rebuild-start', 30_000);

		// Should get rebuild-error, react-update, or rebuild-complete
		const next = await Promise.race([
			client.waitFor('rebuild-error', 30_000),
			client.waitFor('react-update', 30_000),
			client.waitFor('rebuild-complete', 30_000)
		]);

		expect(next.type).toBeDefined();
	}, 60_000);

	test('server still serves other pages after build error', async () => {
		const res = await fetch(`${server.baseUrl}/html`);
		expect(res.ok).toBe(true);
	});

	test('hmr-status endpoint remains functional after error', async () => {
		const statusRes = await fetch(`${server.baseUrl}/hmr-status`);
		expect(statusRes.ok).toBe(true);
		const status = await statusRes.json();
		expect(status.connectedClients).toBeGreaterThanOrEqual(1);
		expect(status.manifestKeys.length).toBeGreaterThan(0);
	});

	test('new WS connection works after error recovery', async () => {
		// Restore files to clean state
		restoreAllFiles();

		// Wait for any rebuild from restore to settle
		await Bun.sleep(5_000);

		// A fresh client can connect and get manifest + connected
		client.close();
		client = await connectHMR(server.port);
		const manifest = await client.waitFor('manifest');
		expect(manifest.type).toBe('manifest');
		const connected = await client.waitFor('connected');
		expect(connected.type).toBe('connected');
	}, 60_000);
});
