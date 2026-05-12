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
	return { client: client!, server: server! };
};

/* bun#30447 / bun#30449 are upstream Bun bugs around `bun --hot`
 * caching the ENTRY module's source. The natural HMR pattern
 * (`delete require.cache[entryPath]; await import(entryPath)`)
 * threw "Requested module is not instantiated yet" under
 * `--hot` before 1.3.14 (#30447). 1.3.14's WebKit-module-loader
 * rewrite fixed the throw for non-entry modules, but `--hot` still
 * holds the pinned entry module record across atomic-rename writes,
 * so a userland cache invalidation re-runs the top-level but reads
 * STALE source bytes (#30449).
 *
 * AbsoluteJS's workaround in `serverEntryWatcher.ts`:
 *   1. On every entry change, copy the entry to a unique sibling
 *      path (`.absolutejs-hmr-<ts>-<rand>.ts`) — different URL key
 *      means `--hot` doesn't own the sibling.
 *   2. `await import(siblingPath)` — Bun parses+transpiles the
 *      sibling FRESH every time.
 *   3. The sibling is deleted in `finally`. The watcher's
 *      `isAtomicWriteTemp` regex filters the transient sibling so
 *      it doesn't queue a spurious HMR cycle for itself.
 *
 * Verified end-to-end by injecting a sentinel route via
 * `mutateFile(serverEntry, …)` and asserting the route exposes the
 * new bytes (not the cached entry record) on the next request.
 * Without the workaround, the sentinel route would 404 because the
 * imported module would still be the pre-edit version.
 *
 * Multi-cycle stability (repeated entry edits picking up fresh bytes
 * each time) and the sibling-file unlink event not retriggering the
 * watcher are not tested here — both are racy to assert from a black-
 * box test because they depend on Bun's atomic-write event ordering
 * and the watcher's 100ms dedupe. The atomic-write filter itself is
 * unit-tested in tests/unit/dev/atomic-write-temp-patterns.test.ts. */
describe('bun#30449 entry-path stale-source workaround', () => {
	test(
		'serverEntry edit lands on the next request (not the stale entry record)',
		async () => {
			const { client: c, server: srv } = await startAll();

			// Sanity: the sentinel route doesn't exist before the
			// edit.
			const before = await fetch(`${srv.baseUrl}/__entry_workaround`);
			expect(before.status).toBe(404);

			// Edit the entry to inject a sentinel route. If
			// bun#30449 wasn't worked around, the next request would
			// hit the pre-edit fetch handler and 404.
			mutateFile(serverEntry, (text) =>
				text.replace(
					'.use(absolutejs)',
					'.use(absolutejs).get("/__entry_workaround", () => "ENTRY_WORKAROUND_OK")'
				)
			);
			await c.waitFor('server-entry-reloaded', 15_000);

			const after = await fetch(`${srv.baseUrl}/__entry_workaround`);
			expect(after.status).toBe(200);
			expect(await after.text()).toBe('ENTRY_WORKAROUND_OK');
		},
		60_000
	);
});
