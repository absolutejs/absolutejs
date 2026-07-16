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

/* Path B's reload re-evaluates the server entry top-level, but
 * does so in the SAME process. Anything stashed on `globalThis`
 * survives — DB pools, sockets, request counters, module-level
 * globals. This is distinct from `app.store` (Elysia-instance
 * state, which has its own preservation path via #211); this test
 * covers the simpler globalThis case.
 *
 * Verified by injecting a counter stashed on globalThis, hitting
 * it three times, triggering a Path B reload, then continuing
 * to increment and observing the counter never resets. */

describe('Module-level state on globalThis survives reload', () => {
	test('setup: start server and connect', async () => {
		server = await startDevServer();
		client = await connectHMR(server.port);
		await client.waitFor('manifest');
		await client.waitFor('connected');
		client.drain();
	}, 60_000);

	test('globalThis counter is preserved across entry reload', async () => {
		const serverEntry = resolve(PROJECT_ROOT, 'example/server.ts');

		mutateFile(serverEntry, (c) =>
			c.replace(
				'.use(absolutejs)',
				`.use(absolutejs).get("/test-counter", () => {
  const g = globalThis as { __testCounter?: number };
  g.__testCounter = (g.__testCounter ?? 0) + 1;
  return String(g.__testCounter);
})`
			)
		);

		// Wait for Path B to apply — the reload broadcasts
		// `server-entry-reloaded` once the new entry is live. A fixed
		// sleep here flaked under load: a slow reload left the route
		// unregistered and all three fetches 404'd.
		await client.waitFor('server-entry-reloaded', 15_000);

		// Route registration can trail the event by a beat — poll until
		// the first successful hit (which is also increment #1, so the
		// poll must consume it as r1 rather than retry past it).
		let r1: string | null = null;
		const routeDeadline = Date.now() + 10_000;
		while (Date.now() < routeDeadline) {
			const res = await fetch(`${server.baseUrl}/test-counter`);
			if (res.ok) {
				r1 = await res.text();
				break;
			}
			await Bun.sleep(200);
		}

		// Hit the counter twice more.
		const r2 = await fetch(`${server.baseUrl}/test-counter`).then((r) =>
			r.text()
		);
		const r3 = await fetch(`${server.baseUrl}/test-counter`).then((r) =>
			r.text()
		);
		expect([r1, r2, r3]).toEqual(['1', '2', '3']);
		client.drain();

		// Trigger another Path B reload via a harmless edit.
		mutateFile(serverEntry, (c) =>
			c.replace(
				'.use(absolutejs)',
				// re-add a no-op alteration to force re-eval
				'.use(absolutejs).get("/test-noop", () => "noop")'
			)
		);
		await client.waitFor('server-entry-reloaded', 15_000);

		// Confirm the SECOND reload's routes are live by polling the
		// new no-op route (the counter route already responds, so it
		// can't distinguish old entry from new).
		const noopDeadline = Date.now() + 10_000;
		while (Date.now() < noopDeadline) {
			const res = await fetch(`${server.baseUrl}/test-noop`);
			if (res.ok) break;
			await Bun.sleep(200);
		}

		// Counter should continue from 4, not reset to 1.
		const r4 = await fetch(`${server.baseUrl}/test-counter`).then((r) =>
			r.text()
		);
		const r5 = await fetch(`${server.baseUrl}/test-counter`).then((r) =>
			r.text()
		);
		expect([r4, r5]).toEqual(['4', '5']);
	}, 30_000);
});
