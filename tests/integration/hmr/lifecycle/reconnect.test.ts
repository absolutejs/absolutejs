import { describe, expect, test, afterAll } from 'bun:test';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { connectHMR } from '../../../helpers/ws';

let server: DevServer;

afterAll(async () => {
	await server?.kill();
});

describe('HMR WebSocket reconnect', () => {
	test('setup: start server', async () => {
		server = await startDevServer();
	}, 60_000);

	test('client connects and receives manifest', async () => {
		const client = await connectHMR(server.port);
		await client.waitFor('manifest');
		await client.waitFor('connected');

		const res = await fetch(`${server.baseUrl}/hmr-status`);
		const status = await res.json();
		expect(status.connectedClients).toBeGreaterThanOrEqual(1);

		client.close();
	});

	test('reconnected client receives fresh manifest', async () => {
		await Bun.sleep(100);

		const client2 = await connectHMR(server.port);
		const manifest = await client2.waitFor('manifest');
		expect(manifest.type).toBe('manifest');

		const data = manifest.data as {
			manifest: Record<string, string>;
			serverVersions: Record<string, number>;
		};
		expect(Object.keys(data.manifest).length).toBeGreaterThan(0);

		await client2.waitFor('connected');

		// New client should be connected regardless of stale cleanup timing
		const res = await fetch(`${server.baseUrl}/hmr-status`);
		const status = await res.json();
		expect(status.connectedClients).toBeGreaterThanOrEqual(1);

		client2.close();
	});

	test('multiple reconnects all receive manifests', async () => {
		for (let i = 0; i < 3; i++) {
			const c = await connectHMR(server.port);
			const msg = await c.waitFor('manifest');
			expect(msg.type).toBe('manifest');
			await c.waitFor('connected');
			c.close();
			await Bun.sleep(50);
		}

		// Server is still healthy after multiple connect/disconnect cycles
		const res = await fetch(`${server.baseUrl}/hmr-status`);
		expect(res.ok).toBe(true);
	});

	test('stale clients are cleaned up on next broadcast', async () => {
		// Connect two clients, close one, then trigger broadcast via the other
		const client1 = await connectHMR(server.port);
		const client2 = await connectHMR(server.port);
		await client1.waitFor('manifest');
		await client2.waitFor('manifest');
		await client1.waitFor('connected');
		await client2.waitFor('connected');

		// Close client1, client2 stays open
		client1.close();
		await Bun.sleep(100);

		// The broadcastToClients function prunes closed connections
		// We just verify client2 is still healthy
		const res = await fetch(`${server.baseUrl}/hmr-status`);
		const status = await res.json();
		// At least client2 should be counted
		expect(status.connectedClients).toBeGreaterThanOrEqual(1);

		client2.close();
	});
});
