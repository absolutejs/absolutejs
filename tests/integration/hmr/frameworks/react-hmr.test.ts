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

describe('React HMR', () => {
	test('setup: start server and connect', async () => {
		server = await startDevServer();
		client = await connectHMR(server.port);
		await client.waitFor('manifest');
		await client.waitFor('connected');
		client.drain();
	}, 60_000);

	test('page component change triggers react-update', async () => {
		const reactPage = resolve(
			PROJECT_ROOT,
			'example/react/pages/ReactExample.tsx'
		);

		mutateFile(reactPage, (c) =>
			c.replace('AbsoluteJS + React', 'AbsoluteJS + React HMR_TEST')
		);

		await client.waitFor('rebuild-start', 15_000);

		// Fast path sends the framework-specific update directly (no rebuild-complete)
		const update = await client.waitFor('react-update', 30_000);
		expect(update.type).toBe('react-update');
	}, 60_000);

	test('update message contains framework data', async () => {
		const updates = client.messages.filter(
			(m) => m.type === 'react-update'
		);
		expect(updates.length).toBeGreaterThan(0);
		const first = updates[0];
		if (!first) return;
		const data = first.data as Record<string, unknown>;
		expect(data.framework).toBe('react');
		expect(data.manifest).toBeDefined();
		expect(data.sourceFiles).toBeDefined();
	});
});
