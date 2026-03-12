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

describe('Angular HMR', () => {
	test('setup: start server and connect', async () => {
		server = await startDevServer();
		client = await connectHMR(server.port);
		await client.waitFor('manifest');
		await client.waitFor('connected');
		client.drain();
	}, 60_000);

	test('angular page change triggers angular-update', async () => {
		const angularPage = resolve(
			PROJECT_ROOT,
			'example/angular/pages/angular-example.ts'
		);

		mutateFile(angularPage, (c) =>
			c.replace('AbsoluteJS + Angular', 'AbsoluteJS + Angular HMR_TEST')
		);

		await client.waitFor('rebuild-start', 15_000);

		// Fast path sends the framework-specific update directly (no rebuild-complete)
		const update = await client.waitFor('angular-update', 30_000);
		expect(update.type).toBe('angular-update');
	}, 60_000);

	test('update message contains framework data', async () => {
		const updates = client.messages.filter(
			(m) => m.type === 'angular-update'
		);
		expect(updates.length).toBeGreaterThan(0);
		const data = updates[0].data as Record<string, unknown>;
		expect(data.framework).toBe('angular');
		expect(data.manifest).toBeDefined();
		expect(data.sourceFile).toBeDefined();
	});
});
