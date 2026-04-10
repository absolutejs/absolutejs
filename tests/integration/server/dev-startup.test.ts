import { describe, expect, test, afterAll } from 'bun:test';
import { startDevServer, type DevServer } from '../../helpers/devServer';
import { connectHMR, type HMRClient } from '../../helpers/ws';

let server: DevServer;
let hmrClient: HMRClient;
const DEVTOOLS_ENDPOINT = '/.well-known/appspecific/com.chrome.devtools.json';

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

	test('chrome devtools workspace endpoint responds with project root', async () => {
		const res = await fetch(`${server.baseUrl}${DEVTOOLS_ENDPOINT}`);
		expect(res.ok).toBe(true);
		expect(res.headers.get('content-type')).toContain('application/json');

		const body = (await res.json()) as {
			workspace: { root: string; uuid: string };
		};
		expect(body.workspace.root.length).toBeGreaterThan(0);
		expect(
			body.workspace.root.startsWith('/') ||
				body.workspace.root.startsWith('\\\\')
		).toBe(true);
		expect(body.workspace.uuid).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
		);
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
