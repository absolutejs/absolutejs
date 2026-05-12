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

/* When the user edits server.ts and introduces a top-level throw
 * (e.g. fat-fingered an import path), `serverEntryWatcher.ts`'s
 * natural-pattern re-import rejects. Its catch handler logs the
 * error and emits the `[abs:restart] <entryPath>` stdout marker —
 * the agreed contract with the parent CLI's supervisor in
 * `src/cli/scripts/dev.ts`, which interprets it as "child can't
 * recover in place, please respawn me."
 *
 * The OLD app keeps serving until the supervisor respawn kicks in,
 * which means HMR clients connected before the bad edit see
 * uninterrupted service. The natural-pattern catch path also
 * shouldn't crash the child — it must stay alive long enough for
 * the CLI to see the marker and orchestrate a clean restart. */
describe('server.ts top-level throw — falls back to [abs:restart] marker', () => {
	test(
		'mutating server.ts to throw at top-level emits [abs:restart] and the OLD app keeps serving',
		async () => {
			server = await startDevServer();
			client = await connectHMR(server.port);
			await client.waitFor('manifest');
			await client.waitFor('connected');
			client.drain();

			// Sanity: dev server is healthy and responding.
			expect(
				(await fetch(`${server.baseUrl}/hmr-status`)).status
			).toBe(200);

			// Inject a top-level throw into server.ts. The
			// serverEntryWatcher's `await import(entryPath)` will
			// reject with this error and the catch handler emits
			// `[abs:restart] <entryPath>` to stdout.
			mutateFile(serverEntry, (text) =>
				text.replace(
					/^/,
					"throw new Error('TOP_LEVEL_BOOT_THROW');\n"
				)
			);

			// `[abs:restart] <entryPath>` is what the parent CLI's
			// monitor watches for to know "respawn the child".
			const marker = await server.waitForOutput(
				/\[abs:restart\] .*example\/server\.ts/,
				{ timeoutMs: 20_000 }
			);
			expect(marker).toMatch(/\[abs:restart\]/);

			// The CURRENT bun child stays alive after the failed
			// re-import — the OLD app keeps serving its routes
			// until the parent supervisor would otherwise respawn.
			// In the test setup we don't have the parent CLI in
			// the loop, so we just verify the existing child
			// remains responsive (no crash on the failed import).
			const stillUp = await fetch(`${server.baseUrl}/hmr-status`);
			expect(stillUp.status).toBe(200);

			// And the OLD routes (registered by the pre-edit
			// server.ts that's still running) still respond.
			const oldVue = await fetch(`${server.baseUrl}/vue`);
			expect(oldVue.status).toBeLessThan(500);
			expect((await oldVue.text()).length).toBeGreaterThan(200);
		},
		60_000
	);
});
