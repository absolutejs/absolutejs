import { describe, expect, test, afterAll } from 'bun:test';
import { startDevServer, type DevServer } from '../../helpers/devServer';
import { connectHMR, type HMRClient } from '../../helpers/ws';

let server: DevServer;
let hmrClient: HMRClient;

afterAll(async () => {
	hmrClient?.close();
	await server?.kill();
});

describe('dev server startup', () => {
	test('server starts and becomes ready', async () => {
		server = await startDevServer();
		expect(server.port).toBeGreaterThan(0);
		expect(server.baseUrl).toContain('http://localhost');
	}, 60_000);

	test('hmr-status endpoint responds', async () => {
		const res = await fetch(`${server.baseUrl}/hmr-status`);
		expect(res.ok).toBe(true);

		const status = await res.json();
		expect(status).toHaveProperty('connectedClients');
		expect(status).toHaveProperty('isRebuilding');
		expect(status).toHaveProperty('manifestKeys');
		expect(status).toHaveProperty('timestamp');
		expect(Array.isArray(status.manifestKeys)).toBe(true);
		expect(status.manifestKeys.length).toBeGreaterThan(0);
	});

	test('hmr websocket accepts connections', async () => {
		hmrClient = await connectHMR(server.port);
		expect(hmrClient.ws.readyState).toBe(WebSocket.OPEN);
	});

	test('hmr websocket sends manifest on connect', async () => {
		const manifest = await hmrClient.waitFor('manifest');
		expect(manifest.type).toBe('manifest');

		const data = manifest.data as {
			manifest: Record<string, string>;
			serverVersions: Record<string, number>;
		};
		expect(data.manifest).toBeDefined();
		expect(typeof data.manifest).toBe('object');
		expect(data.serverVersions).toBeDefined();
	});

	test('hmr websocket sends connected message', async () => {
		const connected = await hmrClient.waitFor('connected');
		expect(connected.type).toBe('connected');
	});

	test('hmr-status shows connected client', async () => {
		const res = await fetch(`${server.baseUrl}/hmr-status`);
		const status = await res.json();
		expect(status.connectedClients).toBeGreaterThanOrEqual(1);
	});
});
