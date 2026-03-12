import { describe, expect, test, afterAll } from 'bun:test';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { connectHMR, type HMRClient } from '../../../helpers/ws';

let server: DevServer;
let client: HMRClient;
let manifestData: {
	manifest: Record<string, string>;
	serverVersions: Record<string, number>;
};

afterAll(async () => {
	client?.close();
	await server?.kill();
});

describe('HMR cold start', () => {
	test('fresh server starts and accepts WS connection', async () => {
		server = await startDevServer();
		client = await connectHMR(server.port);
		expect(client.ws.readyState).toBe(WebSocket.OPEN);
	}, 60_000);

	test('receives manifest with asset paths', async () => {
		const msg = await client.waitFor('manifest');
		manifestData = msg.data as typeof manifestData;

		expect(Object.keys(manifestData.manifest).length).toBeGreaterThan(0);

		// Should have entries for each framework's pages
		const keys = Object.keys(manifestData.manifest);
		expect(keys.some((k) => k.includes('React'))).toBe(true);
		expect(keys.some((k) => k.includes('Svelte'))).toBe(true);
		expect(keys.some((k) => k.includes('Vue'))).toBe(true);
		expect(keys.some((k) => k.includes('Angular'))).toBe(true);
		expect(keys.some((k) => k.includes('HTML'))).toBe(true);
		expect(keys.some((k) => k.includes('HTMX'))).toBe(true);
	});

	test('server versions are present on cold start', async () => {
		expect(manifestData.serverVersions).toBeDefined();
		expect(typeof manifestData.serverVersions).toBe('object');
	});

	test('receives connected confirmation', async () => {
		const msg = await client.waitFor('connected');
		expect(msg.type).toBe('connected');
	});

	test('hmr-status reflects connected client', async () => {
		const res = await fetch(`${server.baseUrl}/hmr-status`);
		const status = await res.json();
		expect(status.connectedClients).toBe(1);
		expect(status.isRebuilding).toBe(false);
		expect(status.rebuildQueue).toEqual([]);
	});

	test('second client receives independent manifest', async () => {
		const client2 = await connectHMR(server.port);
		const msg = await client2.waitFor('manifest');
		expect(msg.type).toBe('manifest');

		const res = await fetch(`${server.baseUrl}/hmr-status`);
		const status = await res.json();
		expect(status.connectedClients).toBe(2);

		client2.close();
	});
});
