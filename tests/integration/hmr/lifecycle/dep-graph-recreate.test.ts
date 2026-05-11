import { describe, expect, test, afterAll, afterEach } from 'bun:test';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { connectHMR, type HMRClient } from '../../../helpers/ws';
import { restoreAllFiles } from '../../../helpers/file';

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

/* Verifies the dependency graph correctly reconnects reverse-links
 * after a file is deleted and recreated. Pre-fix,
 * `removeDependentsForFile` mutated each dependent's deps list to
 * drop the deleted file's path. When the file was recreated,
 * `addFileToGraph` had no way to know which files used to import
 * it — the reverse-link was permanently severed. Result: editing
 * the recreated file never propagated to importers until the
 * importer itself was touched. */

describe('Dep graph reverse-link after delete+recreate', () => {
	test('setup: start server and connect', async () => {
		server = await startDevServer();
		client = await connectHMR(server.port);
		await client.waitFor('manifest');
		await client.waitFor('connected');
		client.drain();
	}, 60_000);

	test('recreated dependency re-establishes dep-graph reverse-link', async () => {
		// Use the counter component template (referenced by
		// counter.component.ts via templateUrl). Delete + recreate
		// with a sentinel injected; the .ts file shouldn't need
		// touching for the angular page's SSR to pick up the
		// recreated template's content.
		const target = resolve(
			PROJECT_ROOT,
			'example/angular/templates/counter.component.html'
		);
		const original = readFileSync(target, 'utf-8');
		const marker = 'DEP_GRAPH_RECREATED_MARKER';
		expect(original).not.toContain(marker);

		try {
			unlinkSync(target);
			// Dep-graph removal fires. Pre-fix, this severed the
			// reverse-link from dependents. Post-fix
			// (`dependencyGraph.ts` change), the link survives so
			// the recreate below can reconnect.
			await Bun.sleep(800);

			const next = original.replace(/count is/, `count is ${marker}`);
			expect(next).toContain(marker);
			writeFileSync(target, next, 'utf-8');

			// Wait for the rebuild debounce + Angular bundle rebuild.
			await Bun.sleep(6_000);

			const res = await fetch(`${server.baseUrl}/angular`);
			const html = await res.text();
			expect(html).toContain(marker);
		} finally {
			writeFileSync(target, original, 'utf-8');
			expect(existsSync(target)).toBe(true);
		}
	}, 60_000);
});
