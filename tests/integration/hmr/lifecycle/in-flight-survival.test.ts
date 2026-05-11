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

/* Path B's contract: in-flight requests survive an entry reload.
 * The reload swaps `Bun.serve`'s fetch handler atomically; sockets
 * persist; requests already in their old handler keep their old
 * handler. New requests after the swap hit the new handler.
 *
 * Verified by issuing a slow request, then triggering a reload
 * mid-flight, then asserting both:
 * 1. The slow request completes with its ORIGINAL handler's body.
 * 2. A request issued AFTER the reload gets the new behavior.
 *
 * The test injects a temporary slow route into server.ts (Path B
 * applies the new route on the new handler) and restores the file
 * after. */

describe('In-flight request survives Path B reload', () => {
	test('setup: start server and connect', async () => {
		server = await startDevServer();
		client = await connectHMR(server.port);
		await client.waitFor('manifest');
		await client.waitFor('connected');
		client.drain();
	}, 60_000);

	test('slow request finishes with original handler after reload', async () => {
		const serverEntry = resolve(PROJECT_ROOT, 'example/server.ts');

		// Add a slow-poll route + a marker route so we can verify
		// the new handler is active. The slow route uses Bun.sleep
		// to hold the request open across the reload.
		mutateFile(serverEntry, (c) =>
			c.replace(
				'const { absolutejs, manifest } = await prepare();',
				`const { absolutejs, manifest } = await prepare();
const __testMarker = "before-edit";
const __testSlowResponse = async () => {
  await Bun.sleep(2500);
  return __testMarker;
};`
			).replace(
				'.use(absolutejs)',
				'.use(absolutejs).get("/test-slow", () => __testSlowResponse()).get("/test-marker", () => __testMarker)'
			)
		);
		// Wait for Path B reload to apply.
		await Bun.sleep(3_500);

		// Confirm marker route works pre-flight.
		const markerBefore = await fetch(`${server.baseUrl}/test-marker`).then(
			(r) => r.text()
		);
		expect(markerBefore).toBe('before-edit');

		// Kick off the slow request — don't await yet.
		const slowPromise = fetch(`${server.baseUrl}/test-slow`).then((r) =>
			r.text()
		);

		// Mid-flight, flip the marker via another Path B edit.
		await Bun.sleep(300);
		mutateFile(serverEntry, (c) =>
			c.replace('"before-edit"', '"after-edit"')
		);
		await Bun.sleep(1_500);

		// New requests after the reload should see "after-edit".
		const markerAfter = await fetch(`${server.baseUrl}/test-marker`).then(
			(r) => r.text()
		);
		expect(markerAfter).toBe('after-edit');

		// The in-flight slow request, which started under the OLD
		// handler, should finish with "before-edit".
		const slowResult = await slowPromise;
		expect(slowResult).toBe('before-edit');
	}, 30_000);
});
