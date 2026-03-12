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

describe('Component-level HMR', () => {
	test('setup: start server and connect', async () => {
		server = await startDevServer();
		client = await connectHMR(server.port);
		await client.waitFor('manifest');
		await client.waitFor('connected');
		client.drain();
	}, 60_000);

	test('react child component change triggers react-update', async () => {
		const reactComponent = resolve(
			PROJECT_ROOT,
			'example/react/components/App.tsx'
		);

		mutateFile(reactComponent, (c) =>
			c.replace('AbsoluteJS + React', 'AbsoluteJS + React COMPONENT_TEST')
		);

		await client.waitFor('rebuild-start', 15_000);

		const update = await client.waitFor('react-update', 30_000);
		expect(update.type).toBe('react-update');

		const data = update.data as Record<string, unknown>;
		expect(data.framework).toBe('react');
		expect(data.manifest).toBeDefined();
	}, 60_000);

	test('svelte child component change triggers svelte-update', async () => {
		client.drain();

		const svelteComponent = resolve(
			PROJECT_ROOT,
			'example/svelte/components/Counter.svelte'
		);

		mutateFile(svelteComponent, (c) =>
			c.replace('count is {getCount()}', 'counter is {getCount()}')
		);

		await client.waitFor('rebuild-start', 15_000);

		const update = await client.waitFor('svelte-update', 30_000);
		expect(update.type).toBe('svelte-update');

		const data = update.data as Record<string, unknown>;
		expect(data.framework).toBe('svelte');
		expect(data.manifest).toBeDefined();
	}, 60_000);

	test('vue child component change triggers vue-update', async () => {
		client.drain();

		const vueComponent = resolve(
			PROJECT_ROOT,
			'example/vue/components/CountButton.vue'
		);

		mutateFile(vueComponent, (c) =>
			c.replace('count is {{ count }}', 'counter is {{ count }}')
		);

		await client.waitFor('rebuild-start', 15_000);

		const update = await client.waitFor('vue-update', 30_000);
		expect(update.type).toBe('vue-update');

		const data = update.data as Record<string, unknown>;
		expect(data.framework).toBe('vue');
		expect(data.manifest).toBeDefined();
	}, 60_000);

	test('angular child component change triggers angular-update', async () => {
		client.drain();

		const angularComponent = resolve(
			PROJECT_ROOT,
			'example/angular/components/counter.component.ts'
		);

		mutateFile(angularComponent, (c) =>
			c.replace('count is', 'counter is')
		);

		await client.waitFor('rebuild-start', 15_000);

		const update = await client.waitFor('angular-update', 30_000);
		expect(update.type).toBe('angular-update');

		const data = update.data as Record<string, unknown>;
		expect(data.framework).toBe('angular');
		expect(data.manifest).toBeDefined();
	}, 60_000);
});
