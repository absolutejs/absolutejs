import { describe, expect, test, afterAll, afterEach } from 'bun:test';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
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

// Find a CSS file to test with
const findCSSFile = () => {
	const candidates = [
		'example/styles/indexes/react-example.css',
		'example/styles/indexes/svelte-example.css',
		'example/styles/indexes/vue-example.css',
		'example/styles/indexes/html-example.css',
		'example/styles/main.css',
		'example/styles/reset.css'
	];
	for (const candidate of candidates) {
		const full = resolve(PROJECT_ROOT, candidate);
		if (existsSync(full)) return full;
	}

	return null;
};

describe('CSS HMR', () => {
	test('setup: start server and connect', async () => {
		server = await startDevServer();
		client = await connectHMR(server.port);
		await client.waitFor('manifest');
		await client.waitFor('connected');
		client.drain();
	}, 60_000);

	test('CSS file change triggers rebuild', async () => {
		const cssFile = findCSSFile();
		if (!cssFile) {
			console.log('No CSS file found to test, skipping');

			return;
		}

		mutateFile(cssFile, (c) => `${c}\n/* css-hmr-test */`);

		await client.waitFor('rebuild-start', 15_000);

		// Wait for updates to arrive — the fast path may not send rebuild-complete
		await Bun.sleep(5_000);

		// Should receive either a style-update or a framework-specific update
		// depending on how the CSS is associated
		const messages = client.messages.filter(
			(m) => m.type === 'style-update' || m.type.endsWith('-update')
		);
		expect(messages.length).toBeGreaterThan(0);
	}, 60_000);
});
