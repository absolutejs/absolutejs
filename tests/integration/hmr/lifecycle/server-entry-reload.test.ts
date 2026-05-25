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

const startAll = async () => {
	server = await startDevServer();
	client = await connectHMR(server.port);
	await client.waitFor('manifest');
	await client.waitFor('connected');
	client.drain();

	return { client: client, server: server };
};

/* Path B server-entry reload contract: after editing the user's
 * server.ts, the next request hits the new bytes via Bun.serve's
 * .reload({ fetch, routes: {} }) (called from the freshly-imported
 * module's `networking` plugin) — not the pre-edit handler from the
 * pinned entry module record.
 *
 * Used to require a sibling-copy workaround for bun#30447/#30449 (see
 * docs/BUN_HOT_WATCHER_BUG.md for the history). The current implementation
 * uses the natural `delete require_.cache[entryPath]; await import(entryPath)`
 * pattern; the snapshot in bun-entry-natural-pattern-sentinel.test.ts
 * pins that contract against the current Bun version. */
describe('server-entry reload after edit', () => {
	test('serverEntry edit lands on the next request (not the stale entry record)', async () => {
		const { client: c, server: srv } = await startAll();

		const before = await fetch(`${srv.baseUrl}/__entry_reload_probe`);
		expect(before.status).toBe(404);

		mutateFile(serverEntry, (text) =>
			text.replace(
				'.use(absolutejs)',
				'.use(absolutejs).get("/__entry_reload_probe", () => "RELOAD_OK")'
			)
		);
		await c.waitFor('server-entry-reloaded', 15_000);

		const after = await fetch(`${srv.baseUrl}/__entry_reload_probe`);
		expect(after.status).toBe(200);
		expect(await after.text()).toBe('RELOAD_OK');
	}, 60_000);
});
