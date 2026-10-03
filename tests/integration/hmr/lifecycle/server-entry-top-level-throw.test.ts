import { describe, expect, test, afterEach } from 'bun:test';
import { resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { connectHMR, type HMRClient } from '../../../helpers/ws';
import { mutateFile, restoreAllFiles } from '../../../helpers/file';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');

let server: DevServer | undefined;
let client: HMRClient | undefined;

afterEach(async () => {
	client?.close();
	client = undefined;
	if (server) {
		await server.kill();
		server = undefined;
	}
	restoreAllFiles();
});

const serverEntry = resolve(PROJECT_ROOT, 'example/server.ts');

const injectThrow = () =>
	mutateFile(serverEntry, (text) =>
		text.replace(/^/, "throw new Error('TOP_LEVEL_BOOT_THROW');\n")
	);

const expectOldAppServing = async (baseUrl: string) => {
	expect((await fetch(`${baseUrl}/hmr-status`)).status).toBe(200);
	const oldVue = await fetch(`${baseUrl}/vue`);
	expect(oldVue.status).toBeLessThan(500);
	expect((await oldVue.text()).length).toBeGreaterThan(200);
};

const restartLines = () =>
	(server?.outputLines ?? []).filter((line) =>
		line.includes('[abs:restart]')
	);

const connect = async (env?: Record<string, string>) => {
	server = await startDevServer(env ? { env } : undefined);
	client = await connectHMR(server.port);
	await client.waitFor('manifest');
	await client.waitFor('connected');
	client.drain();
	expect((await fetch(`${server.baseUrl}/hmr-status`)).status).toBe(200);

	return server;
};

/* A top-level throw in server.ts (a fat-fingered import, a bad config
 * read) fails the entry's re-evaluation. With backend HMR (the default)
 * the hot runtime rolls back what the failed version started and the
 * previous app keeps serving: no restart, and the next valid save applies
 * in place. With backend HMR off, the watcher emits the
 * `[abs:restart] <entryPath>` stdout marker, the contract with the parent
 * CLI's supervisor in `src/cli/scripts/dev.ts` ("respawn me"), and the old
 * app serves until that respawn. Either way the child must not crash. */
describe('server.ts top-level throw', () => {
	test('with backend HMR, the failed version is rolled back and the OLD app keeps serving', async () => {
		const { baseUrl } = await connect();
		injectThrow();
		await server?.waitForOutput(
			/entry re-evaluation failed: TOP_LEVEL_BOOT_THROW/,
			{ timeoutMs: 20_000 }
		);
		await expectOldAppServing(baseUrl);
		expect(restartLines()).toEqual([]);

		// The fix applies in place, without a restart either.
		restoreAllFiles();
		await client?.waitFor('server-entry-reloaded', 20_000);
		await expectOldAppServing(baseUrl);
		expect(restartLines()).toEqual([]);
	}, 60_000);

	test('with backend HMR off, it emits [abs:restart] and the OLD app keeps serving', async () => {
		const { baseUrl } = await connect({ ABSOLUTE_BACKEND_HMR: '0' });
		injectThrow();
		const marker = await server?.waitForOutput(
			/\[abs:restart\] .*example\/server\.ts/,
			{ timeoutMs: 20_000 }
		);
		expect(marker).toMatch(/\[abs:restart\]/);
		// No parent CLI here to respawn the child: it stays up on the old app.
		await expectOldAppServing(baseUrl);
	}, 60_000);
});
