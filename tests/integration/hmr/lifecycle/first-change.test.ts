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

describe('HMR first change (cold cache)', () => {
	test('setup: start server and connect', async () => {
		server = await startDevServer();
		client = await connectHMR(server.port);
		await client.waitFor('manifest');
		await client.waitFor('connected');
		client.drain();
	}, 60_000);

	test('react page change triggers rebuild and framework update', async () => {
		const reactPage = resolve(
			PROJECT_ROOT,
			'example/react/pages/ReactExample.tsx'
		);

		mutateFile(reactPage, (content) =>
			content.replace('AbsoluteJS + React', 'AbsoluteJS + React MODIFIED')
		);

		// Should receive rebuild-start
		const rebuildStart = await client.waitFor('rebuild-start', 15_000);
		expect(rebuildStart.type).toBe('rebuild-start');

		// Fast path sends framework update directly (no rebuild-complete for single-framework changes)
		const update = await client.waitFor('react-update', 30_000);
		expect(update.type).toBe('react-update');
	}, 60_000);

	test('server is still responsive after change', async () => {
		// The mutated page might cause SSR errors, so check server health instead
		const statusRes = await fetch(`${server.baseUrl}/hmr-status`);
		expect(statusRes.ok).toBe(true);

		// Other pages should still work
		const htmlRes = await fetch(`${server.baseUrl}/html`);
		expect(htmlRes.ok).toBe(true);
	});
});
