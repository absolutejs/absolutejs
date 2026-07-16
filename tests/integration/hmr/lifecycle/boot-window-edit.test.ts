import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { connectHMR, type HMRClient } from '../../../helpers/ws';
import { mutateFile, restoreAllFiles } from '../../../helpers/file';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');

let server: DevServer | undefined;
let client: HMRClient | undefined;

afterEach(() => {
	restoreAllFiles();
});

afterAll(async () => {
	client?.close();
	await server?.kill();
});

/* Boot-window race: file watchers used to start only AFTER the initial
 * build (plus asset-store population and compiler warming), so an edit
 * saved during that window produced NO watcher event. The build reads
 * each source file at an unknowable point mid-build, so the edit could
 * be consumed by some passes and missed by others — a mixed first build
 * that nothing healed until the user happened to edit the file again.
 *
 * Watchers now start before the initial build with `isRebuilding` held,
 * queuing mid-boot edits, and the queue is drained into a rebuild once
 * boot completes. This test saves an edit the moment the watcher comes
 * up — mid-boot by construction, since the marker line prints before
 * `build()` starts — and asserts the served SSR HTML converges to the
 * edited content without any further edit. */
describe('edit saved during the boot build', () => {
	test('is queued and rebuilt once boot completes', async () => {
		const composable = resolve(
			PROJECT_ROOT,
			'example/svelte/composables/counter.svelte.ts'
		);

		let markWatcherActive = () => {};
		const watcherActive = new Promise<void>((_resolve) => {
			markWatcherActive = _resolve;
		});
		const serverPromise = startDevServer({
			onLine: (line) => {
				if (line.includes('watching for file changes')) {
					markWatcherActive();
				}
			}
		}).catch((err: unknown) => {
			// Unblock the marker await so a failed boot surfaces as the
			// server error below instead of hanging this test.
			markWatcherActive();
			throw err;
		});

		await watcherActive;
		mutateFile(composable, (contents) =>
			contents.replace(
				'let count = $state(initialCount);',
				'let count = $state(initialCount + 41);'
			)
		);

		server = await serverPromise;
		client = await connectHMR(server.port);

		const deadline = Date.now() + 45_000;
		let html = '';
		while (Date.now() < deadline) {
			html = await (await fetch(`${server.baseUrl}/svelte`)).text();
			if (html.includes('count is 41')) break;
			await Bun.sleep(500);
		}
		expect(html).toContain('count is 41');
	}, 120_000);
});
