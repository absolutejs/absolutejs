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

describe('HMR rapid changes (debounce)', () => {
	test('setup: start server and connect', async () => {
		server = await startDevServer();
		client = await connectHMR(server.port);
		await client.waitFor('manifest');
		await client.waitFor('connected');
		client.drain();
	}, 60_000);

	test('rapid edits within debounce window batch into single rebuild', async () => {
		const htmlFile = resolve(
			PROJECT_ROOT,
			'example/html/pages/HTMLExample.html'
		);

		// Make 3 rapid changes
		mutateFile(htmlFile, (c) =>
			c.replace('</body>', '<!-- change1 --></body>')
		);
		restoreAllFiles();
		mutateFile(htmlFile, (c) =>
			c.replace('</body>', '<!-- change2 --></body>')
		);
		restoreAllFiles();
		mutateFile(htmlFile, (c) =>
			c.replace('</body>', '<!-- change3 --></body>')
		);

		// Should get at least one rebuild cycle
		await client.waitFor('rebuild-start', 15_000);

		// Wait for an update to arrive (html-update, rebuild-complete, or similar)
		await Bun.sleep(5_000);

		// Count how many rebuild-start messages we got
		const rebuildStarts = client.messages.filter(
			(m) => m.type === 'rebuild-start'
		);
		// With proper debouncing, rapid changes should collapse
		expect(rebuildStarts.length).toBeLessThanOrEqual(2);
	}, 60_000);

	test('server is healthy after rapid changes', async () => {
		const res = await fetch(`${server.baseUrl}/hmr-status`);
		const status = await res.json();
		expect(status.isRebuilding).toBe(false);
	});
});
