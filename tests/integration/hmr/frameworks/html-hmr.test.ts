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

describe('HTML HMR', () => {
	test('setup: start server and connect', async () => {
		server = await startDevServer();
		client = await connectHMR(server.port);
		await client.waitFor('manifest');
		await client.waitFor('connected');
		client.drain();
	}, 60_000);

	test('html page change triggers html-update', async () => {
		const htmlPage = resolve(
			PROJECT_ROOT,
			'example/html/pages/HTMLExample.html'
		);

		mutateFile(htmlPage, (c) =>
			c.replace('</body>', '<p>HMR_TEST_HTML</p></body>')
		);

		await client.waitFor('rebuild-start', 15_000);

		// Fast path sends the framework-specific update directly (no rebuild-complete)
		const update = await client.waitFor('html-update', 30_000);
		expect(update.type).toBe('html-update');
	}, 60_000);

	test('update message contains framework data', async () => {
		const updates = client.messages.filter((m) => m.type === 'html-update');
		expect(updates.length).toBeGreaterThan(0);
		const [first] = updates;
		if (!first) return;
		const data = first.data as Record<string, unknown>;
		expect(data.framework).toBe('html');
		expect(data.manifest).toBeDefined();
		expect(data.html).toBeDefined();
	});

	test('html update contains body content with changes', async () => {
		await Bun.sleep(2000);
		client.drain();

		const htmlPage = resolve(
			PROJECT_ROOT,
			'example/html/pages/HTMLExample.html'
		);
		mutateFile(htmlPage, (c) =>
			c.replace('</body>', `<p>HMR_BODY_${Date.now()}</p></body>`)
		);

		const update = await client.waitFor('html-update', 15_000);
		const data = update.data as Record<string, unknown>;
		const html = data.html as string | { body?: string };
		const body =
			typeof html === 'string' ? html : html?.body ?? '';
		expect(body).toContain('HMR_BODY_');
	}, 30_000);
});
