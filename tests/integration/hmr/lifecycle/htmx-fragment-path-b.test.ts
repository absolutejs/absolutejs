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

/* HTMX fragment endpoints are plain Elysia routes registered in
 * `server.ts`. Editing the handler body must propagate via Path B
 * (the in-place `Bun.serve.reload({ fetch, routes:{} })` swap) so
 * the next htmx request sees the new response without losing
 * sockets or app state. Verified by changing the `/htmx/count`
 * response body and asserting the new bytes appear on the next
 * fetch. */
describe('HTMX fragment endpoint edits propagate via Path B', () => {
	test('setup', async () => {
		server = await startDevServer();
		client = await connectHMR(server.port);
		await client.waitFor('manifest');
		await client.waitFor('connected');
		client.drain();
	}, 60_000);

	test('editing /htmx/count handler changes the response on next request', async () => {
		const serverEntry = resolve(PROJECT_ROOT, 'example/server.ts');

		// Pre-flight: confirm the original handler returns the
		// scopedStore.count value (a number, serialized as "0").
		const before = await (
			await fetch(`${server.baseUrl}/htmx/count`)
		).text();
		expect(before).toBe('0');

		client.drain();
		mutateFile(serverEntry, (c) =>
			c.replace(
				".get('/htmx/count', ({ scopedStore }) => scopedStore.count)",
				".get('/htmx/count', () => 'HTMX_PATH_B_SENTINEL')"
			)
		);

		// Path B broadcasts `server-entry-reloaded` after the
		// Bun.serve.reload({fetch}) swap completes.
		await client.waitFor('server-entry-reloaded');
		const after = await (
			await fetch(`${server.baseUrl}/htmx/count`)
		).text();
		expect(after).toBe('HTMX_PATH_B_SENTINEL');
	}, 15_000);
});
