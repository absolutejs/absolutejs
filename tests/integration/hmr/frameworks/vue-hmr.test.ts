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

describe('Vue HMR', () => {
	test('setup: start server and connect', async () => {
		server = await startDevServer();
		client = await connectHMR(server.port);
		await client.waitFor('manifest');
		await client.waitFor('connected');
		client.drain();
	}, 60_000);

	test('vue page change triggers vue-update', async () => {
		const vuePage = resolve(
			PROJECT_ROOT,
			'example/vue/pages/VueExample.vue'
		);

		mutateFile(vuePage, (c) =>
			c.replace('AbsoluteJS + Vue', 'AbsoluteJS + Vue HMR_TEST')
		);

		await client.waitFor('rebuild-start', 15_000);

		// Fast path sends the framework-specific update directly (no rebuild-complete)
		const update = await client.waitFor('vue-update', 30_000);
		expect(update.type).toBe('vue-update');
	}, 60_000);

	test('update message contains framework data', async () => {
		const updates = client.messages.filter((m) => m.type === 'vue-update');
		expect(updates.length).toBeGreaterThan(0);
		const [first] = updates;
		if (!first) return;
		const data = first.data as Record<string, unknown>;
		expect(data.framework).toBe('vue');
		expect(data.manifest).toBeDefined();
		expect(data.changeType).toBeDefined();
	});

	test('vue template-only change is detected', async () => {
		restoreAllFiles();
		client.drain();

		const vuePage = resolve(
			PROJECT_ROOT,
			'example/vue/pages/VueExample.vue'
		);

		// Change only the template, not the script
		mutateFile(vuePage, (c) =>
			c.replace('</template>', '<!-- template change --></template>')
		);

		await client.waitFor('rebuild-start', 15_000);

		// Fast path sends the framework-specific update directly (no rebuild-complete)
		const update = await client.waitFor('vue-update', 30_000);
		expect(update.type).toBe('vue-update');
	}, 60_000);
});
