import { describe, expect, test, afterAll } from 'bun:test';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { connectHMR, type HMRClient } from '../../../helpers/ws';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');
const CONFIG_PATH = resolve(PROJECT_ROOT, 'example/absolute.config.ts');
const SERVER_PATH = resolve(PROJECT_ROOT, 'example/server.ts');

let server: DevServer;
let client: HMRClient;
const originalConfig = readFileSync(CONFIG_PATH, 'utf-8');
const originalServer = readFileSync(SERVER_PATH, 'utf-8');

afterAll(async () => {
	writeFileSync(CONFIG_PATH, originalConfig);
	writeFileSync(SERVER_PATH, originalServer);
	client?.close();
	await server?.kill();
});

describe('HMR config change detection', () => {
	test('start server without svelte, verify svelte pages absent from manifest', async () => {
		// Remove svelteDirectory from config
		const configWithoutSvelte = originalConfig.replace(
			/\tsvelteDirectory:.*,?\n/,
			''
		);
		writeFileSync(CONFIG_PATH, configWithoutSvelte);

		// Remove svelte route + import from server.ts
		let serverWithoutSvelte = originalServer;
		serverWithoutSvelte = serverWithoutSvelte.replace(
			/import \{ handleSveltePageRequest \}.*\n/,
			''
		);
		serverWithoutSvelte = serverWithoutSvelte.replace(
			/\n\t\.get\('\/svelte',[\s\S]*?handleSveltePageRequest[\s\S]*?\}\)/,
			''
		);
		writeFileSync(SERVER_PATH, serverWithoutSvelte);

		server = await startDevServer();
		client = await connectHMR(server.port);

		const manifestMsg = await client.waitFor('manifest', 15_000);
		const { manifest } = manifestMsg.data as {
			manifest: Record<string, string>;
		};

		// Svelte page entries should NOT be in the initial manifest
		const svelteNonCssKeys = Object.keys(manifest).filter(
			(k) => k.includes('Svelte') && !k.endsWith('CSS')
		);
		expect(svelteNonCssKeys).toHaveLength(0);
		expect(Object.keys(manifest).some((k) => k.includes('React'))).toBe(
			true
		);

		// /svelte should 404
		const res = await fetch(`${server.baseUrl}/svelte`);
		expect(res.status).toBe(404);

		await client.waitFor('connected');
		client.drain();
	}, 60_000);

	test('add svelteDirectory to config + restore server.ts, verify /svelte page works', async () => {
		// Write both files back-to-back so Bun's --hot coalesces them into
		// a single reload cycle (one full rebuild instead of two).
		writeFileSync(CONFIG_PATH, originalConfig);
		writeFileSync(SERVER_PATH, originalServer);

		// Poll until the rebuild completes and the svelte route is available.
		let res: Response | undefined;
		for (let i = 0; i < 50; i++) {
			await Bun.sleep(500);
			try {
				res = await fetch(`${server.baseUrl}/svelte`);
				if (res.ok) break;
			} catch {
				// Server may be restarting — retry
			}
		}

		expect(res?.ok).toBe(true);

		const html = await res!.text();
		expect(html).toContain('Svelte');
	}, 30_000);
});
