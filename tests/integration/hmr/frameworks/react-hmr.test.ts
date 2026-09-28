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
		const [first] = updates;
		if (!first) return;
		const data = first.data as Record<string, unknown>;
		expect(data.framework).toBe('react');
		expect(data.manifest).toBeDefined();
		expect(data.sourceFiles).toBeDefined();
	});

	test('fast path provides pageModuleUrl for the changed module', () => {
		const updates = client.messages.filter(
			(m) => m.type === 'react-update'
		);
		const [first] = updates;
		if (!first) throw new Error('no react-update received');
		const data = first.data as Record<string, unknown>;
		expect(String(data.pageModuleUrl)).toStartWith('/@src/');
		expect(String(data.pageModuleUrl)).toContain('ReactExample.tsx');
		expect(data.moduleUrls).toEqual([data.pageModuleUrl]);
	});

	test('SSR catches up after an edit', async () => {
		await server.waitForIdle({ timeoutMs: 30_000 });
		client.drain();
		const app = resolve(PROJECT_ROOT, 'example/react/components/App.tsx');
		mutateFile(app, (c) =>
			c.replace('AbsoluteJS + React', 'AbsoluteJS + React SSR_CAUGHT_UP')
		);
		await client.waitFor('react-update', 30_000);

		// The server entry imports React pages directly, so a fresh request
		// renders the edit once the entry graph has re-evaluated.
		const deadline = Date.now() + 20_000;
		let html = '';
		while (Date.now() < deadline && !html.includes('SSR_CAUGHT_UP')) {
			html = await (await fetch(`${server.baseUrl}/react`)).text();
			if (!html.includes('SSR_CAUGHT_UP')) await Bun.sleep(100);
		}
		expect(html).toContain('SSR_CAUGHT_UP');
	}, 60_000);

	test('subsequent react change also triggers update', async () => {
		// afterEach restores the prior fixture atomically, which itself schedules
		// HMR. Wait for that real queue to settle instead of racing a fixed sleep.
		await server.waitForIdle({ timeoutMs: 30_000 });
		client.drain();

		const reactPage = resolve(
			PROJECT_ROOT,
			'example/react/pages/ReactExample.tsx'
		);
		// Append a unique comment to guarantee the file content changes
		mutateFile(
			reactPage,
			(c) => `${c}\n{/* hmr-fast-path-${Date.now()} */}`
		);

		await client.waitFor('rebuild-start', 30_000);
		const update = await client.waitFor('react-update', 30_000);
		expect(update.type).toBe('react-update');
		const data = update.data as Record<string, unknown>;
		expect(data.framework).toBe('react');
	}, 30_000);

	test('child component change triggers update', async () => {
		await server.waitForIdle({ timeoutMs: 30_000 });
		client.drain();

		const app = resolve(PROJECT_ROOT, 'example/react/components/App.tsx');
		mutateFile(app, (c) =>
			c.replace('AbsoluteJS + React', 'React Child Change')
		);

		await client.waitFor('rebuild-start', 30_000);
		const update = await client.waitFor('react-update', 30_000);
		expect(update.type).toBe('react-update');
	}, 30_000);
});
