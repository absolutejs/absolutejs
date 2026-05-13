import { describe, expect, test, afterEach } from 'bun:test';
import { resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { createFile, mutateFile, restoreAllFiles } from '../../../helpers/file';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');

let server: DevServer | undefined;

afterEach(async () => {
	if (server) {
		await server.kill();
		server = undefined;
	}
	restoreAllFiles();
});

/* Boot-time entry sets are pinned: `svelteEntries`, `vueEntries`,
 * etc. are computed once during the initial dev build and the
 * rebuild plumbing assumes they're stable. Creating a brand-new
 * page file mid-session can't be applied in-place — the new page
 * needs to be in the manifest before the user's server.ts edit
 * (registering a route for it) can compile. The framework's
 * fallback is to emit an `[abs:restart] <path>` stdout marker
 * that the parent CLI picks up and respawns the child against,
 * yielding a fresh boot that scans the new file.
 *
 * Reproduced by: (1) creating `example/svelte/pages/NewlyAddedPage.svelte`
 * mid-session, (2) editing `server.ts` to mount a route for it
 * (which fails to resolve the manifest key from inside the child),
 * (3) observing the `[abs:restart]` marker on the dev server's
 * stdout. The test doesn't actually respawn — that's the parent
 * CLI's job — it just verifies the marker contract. */
describe('Adding a new page entry mid-session falls through to [abs:restart]', () => {
	test('creating a new svelte page + a server route referencing it emits [abs:restart]', async () => {
		server = await startDevServer();
		const pagePath = resolve(
			PROJECT_ROOT,
			'example/svelte/pages/NewlyAddedPage.svelte'
		);
		const serverEntry = resolve(PROJECT_ROOT, 'example/server.ts');

		createFile(
			pagePath,
			`<script lang="ts">\n</script>\n\n<h1>NEW_PAGE_MARKER</h1>\n`
		);
		mutateFile(serverEntry, (c) =>
			c.replace(
				".get('/svelte', () =>",
				".get('/new-page', () =>\n\t\t\thandleSveltePageRequest({\n\t\t\t\tindexPath: asset(manifest, 'NewlyAddedPageIndex'),\n\t\t\t\tpagePath: asset(manifest, 'NewlyAddedPage'),\n\t\t\t\tprops: {}\n\t\t\t})\n\t\t)\n\t\t.get('/svelte', () =>"
			)
		);

		await server.waitForOutput(/\[abs:restart\] .*server\.ts/);
	}, 30_000);
});
