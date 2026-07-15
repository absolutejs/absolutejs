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

const POLL_INTERVAL_MS = 500;

const pollPageFor = async (path: string, marker: string, timeoutMs: number) => {
	const deadline = Date.now() + timeoutMs;
	let html = '';
	while (Date.now() < deadline) {
		const res = await fetch(`${server.baseUrl}${path}`).catch(() => null);
		html = res ? await res.text() : '';
		if (html.includes(marker)) return html;
		await Bun.sleep(POLL_INTERVAL_MS);
	}

	return html;
};

/* An edit saved WHILE a rebuild is in flight must still land. The watcher
 * queues it (`queueFileChange` returns early on `isRebuilding`) and the
 * rebuild's finally-drain owes it a FULL drain — hash bookkeeping and
 * dependency expansion included. The old post-rebuild drain consumed the
 * queue into a timeout closure and passed the raw component path straight to
 * `triggerRebuild`: no content hash was recorded, no dependency expansion
 * ran (a non-entry component rebuilt nothing), and any later watcher event
 * cleared the timeout and destroyed the captured list — the dev server kept
 * serving the stale bundle until the file was edited again or the server
 * restarted. */
describe('edits during an in-flight rebuild', () => {
	test('setup: start server and connect', async () => {
		server = await startDevServer();
		client = await connectHMR(server.port);
		await client.waitFor('manifest');
		await client.waitFor('connected');
		client.drain();
	}, 60_000);

	test('second edit saved mid-rebuild reaches the served page', async () => {
		const component = resolve(
			PROJECT_ROOT,
			'example/react/components/App.tsx'
		);

		client.drain();
		mutateFile(component, (c) =>
			c.replace('AbsoluteJS + React', 'AbsoluteJS + React MID_ONE')
		);

		// The moment the first rebuild starts, save a second edit so it
		// lands while `isRebuilding` is true and must survive the
		// post-rebuild drain.
		await client.waitFor('rebuild-start', 15_000);
		mutateFile(component, (c) => c.replace('MID_ONE', 'MID_TWO'));

		const html = await pollPageFor('/react', 'MID_TWO', 30_000);
		expect(html).toContain('MID_TWO');
	}, 60_000);
});
