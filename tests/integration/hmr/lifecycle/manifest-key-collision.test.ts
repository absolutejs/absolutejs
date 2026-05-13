import { describe, expect, test, afterEach } from 'bun:test';
import { resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { createFile, restoreAllFiles } from '../../../helpers/file';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');

let server: DevServer | undefined;

afterEach(async () => {
	if (server) {
		await server.kill();
		server = undefined;
	}
	restoreAllFiles();
});

/* Bug #223: page files with the same basename across the
 * `htmlDirectory` and `htmxDirectory` (or any other framework
 * dir) collide on a single `manifest[<basename>]` key. Whichever
 * pipeline writes the manifest last wins, and the loser silently
 * 404s when its route handler looks the key up via
 * `asset(manifest, X)`. The fix is a build-time warning so the
 * user sees the issue immediately instead of debugging a runtime
 * 404. The warning has to fire AT BOOT (not just on HMR rebuilds)
 * because the initial build is when the manifest is first
 * populated. */
describe('Manifest key collision across framework dirs (bug #223)', () => {
	test('creating same-basename pages in html/ and htmx/ fires the collision warning on dev startup', async () => {
		const colliding = 'CollisionExample';
		const htmlPage = resolve(
			PROJECT_ROOT,
			`example/html/pages/${colliding}.html`
		);
		const htmxPage = resolve(
			PROJECT_ROOT,
			`example/htmx/pages/${colliding}.html`
		);

		// Stage the conflicting pair BEFORE the dev server boots
		// so the initial build sees them. Each is a minimal valid
		// HTML doc — the collision is on the manifest key, not on
		// any render error.
		createFile(
			htmlPage,
			`<!doctype html><html><body><h1>HTML_${colliding}</h1></body></html>\n`
		);
		createFile(
			htmxPage,
			`<!doctype html><html><body><h1>HTMX_${colliding}</h1></body></html>\n`
		);

		server = await startDevServer();

		// `logWarn` writes `[hmr] warning ...` to stdout. The
		// collision message contains the key name, so we match
		// on that for specificity.
		await server.waitForOutput(
			new RegExp(`Manifest key collision: "${colliding}"`),
			{ timeoutMs: 30_000 }
		);
	}, 60_000);
});
