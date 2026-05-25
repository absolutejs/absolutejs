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

/* HTMX state lives server-side (in this app: in the `scopedStore`
 * per-session map plumbed through elysia-scoped-state). Path B
 * reload (`Bun.serve.reload({ fetch, routes:{} })`) swaps the fetch
 * handler atomically; module-level state on `globalThis` and the
 * scoped-store contents persist across the swap.
 *
 * Test: increment the counter several times, edit `server.ts` to
 * change an unrelated route, wait for the Path B reload signal,
 * then fetch `/htmx/count` and confirm the counter value is
 * preserved. */
describe('HTMX server-side state preservation across Path B reload', () => {
	test('globalThis-stashed counter survives a Path B reload', async () => {
		const { client: c, server: srv } = await startAll();

		// Inject a `/test-counter` route that stashes its counter
		// on globalThis. Hit it 3x, then trigger Path B reload
		// via an unrelated edit, then hit it 2 more times and
		// confirm it continues from 4, 5 (not 1, 2 — proving
		// the global survived).
		mutateFile(serverEntry, (text) =>
			text.replace(
				'.use(absolutejs)',
				`.use(absolutejs).get("/test-counter", () => {
  const g = globalThis as { __htmxTestCounter?: number };
  g.__htmxTestCounter = (g.__htmxTestCounter ?? 0) + 1;
  return String(g.__htmxTestCounter);
})`
			)
		);
		await c.waitFor('server-entry-reloaded', 15_000);

		const r1 = await fetch(`${srv.baseUrl}/test-counter`).then((r) =>
			r.text()
		);
		const r2 = await fetch(`${srv.baseUrl}/test-counter`).then((r) =>
			r.text()
		);
		const r3 = await fetch(`${srv.baseUrl}/test-counter`).then((r) =>
			r.text()
		);
		expect([r1, r2, r3]).toEqual(['1', '2', '3']);

		// Path B reload via a no-op edit.
		c.drain();
		mutateFile(serverEntry, (text) =>
			text.replace(
				'.use(absolutejs)',
				'.use(absolutejs).get("/htmx/noop", () => "noop")'
			)
		);
		await c.waitFor('server-entry-reloaded', 15_000);

		// Counter continues from 4, 5 — globalThis survived.
		const r4 = await fetch(`${srv.baseUrl}/test-counter`).then((r) =>
			r.text()
		);
		const r5 = await fetch(`${srv.baseUrl}/test-counter`).then((r) =>
			r.text()
		);
		expect([r4, r5]).toEqual(['4', '5']);
	}, 60_000);
});
