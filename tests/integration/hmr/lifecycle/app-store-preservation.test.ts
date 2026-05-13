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

/* Verifies the Path B reload preserves the Elysia `app.store`
 * across server-entry edits. Pre-fix, every entry re-eval created
 * a fresh Elysia with a fresh `store: {}`, dropping any state the
 * user (or plugins like `elysia-scoped-state`) had written there.
 *
 * The example/server.ts uses `scopedState({ count: { value: 0 } })`,
 * so we can drive `/htmx/count` (read) and `/htmx/increment`
 * (write) to verify the counter survives an entry edit. */

describe('Path B reload preserves app.store', () => {
	test('setup: start server and connect', async () => {
		server = await startDevServer();
		client = await connectHMR(server.port);
		await client.waitFor('manifest');
		await client.waitFor('connected');
		client.drain();
	}, 60_000);

	test('scopedState counter survives server.ts edit', async () => {
		const jar = 'absolute_test_cookies';
		const cookieFile = `/tmp/${jar}.txt`;

		// Prime the cookie + initial state.
		await Bun.$`rm -f ${cookieFile}`.quiet();
		await Bun.$`curl -s -c ${cookieFile} ${server.baseUrl}/htmx/count`.text();

		// Increment three times.
		for (let i = 0; i < 3; i++) {
			await Bun.$`curl -s -b ${cookieFile} -c ${cookieFile} -X POST ${server.baseUrl}/htmx/increment`.text();
		}
		const before =
			await Bun.$`curl -s -b ${cookieFile} ${server.baseUrl}/htmx/count`.text();
		expect(before.trim()).toBe('3');

		// Trigger a Path B reload by editing server.ts.
		const serverEntry = resolve(PROJECT_ROOT, 'example/server.ts');
		mutateFile(serverEntry, (c) =>
			c.replace(
				'const { absolutejs, manifest } = await prepare();',
				'const { absolutejs, manifest } = await prepare();\nconsole.log("[test] path-b reload sentinel");'
			)
		);

		// Wait for the reload to apply (Path B prints
		// "server module reloaded"). 4s is well above the file
		// watcher debounce.
		await Bun.sleep(4_000);

		// State should still be 3 — preserved across reload.
		const after =
			await Bun.$`curl -s -b ${cookieFile} ${server.baseUrl}/htmx/count`.text();
		expect(after.trim()).toBe('3');

		// Subsequent increments continue from where we left off.
		await Bun.$`curl -s -b ${cookieFile} -c ${cookieFile} -X POST ${server.baseUrl}/htmx/increment`.text();
		const afterInc =
			await Bun.$`curl -s -b ${cookieFile} ${server.baseUrl}/htmx/count`.text();
		expect(afterInc.trim()).toBe('4');
	}, 60_000);
});
