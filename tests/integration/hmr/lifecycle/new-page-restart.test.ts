import { afterEach, describe, expect, test } from 'bun:test';
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

/* A newly-created page and the server route that mounts it can arrive in
 * either order. The framework rebuild owns manifest discovery while the
 * isolated server-entry watcher owns the route swap; both update the same
 * live runtime without requiring the parent CLI to restart the child.
 *
 * Reproduced by: (1) creating `example/svelte/pages/NewlyAddedPage.svelte`
 * mid-session, (2) editing `server.ts` to mount a route for it
 * and (3) waiting until the route serves the new page. */
describe('Adding a new page entry mid-session converges in place', () => {
	test('creating a new svelte page + route serves it without a child restart', async () => {
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

		const deadline = Date.now() + 20_000;
		let body = '';
		while (Date.now() < deadline) {
			const response = await fetch(`${server.baseUrl}/new-page`);
			body = await response.text();
			if (response.ok && body.includes('NEW_PAGE_MARKER')) break;
			await Bun.sleep(100);
		}
		expect(body).toContain('NEW_PAGE_MARKER');
	}, 30_000);
});
