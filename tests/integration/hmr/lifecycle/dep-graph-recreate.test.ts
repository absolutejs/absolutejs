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

	test('recreated file re-establishes dep-graph reverse-link', async () => {
		// Use an Angular service file that's already imported by a
		// component — when we delete + recreate it with new content,
		// the importer's bundle should pick up the new content via
		// the rebuilt reverse-link.
		const target = resolve(
			PROJECT_ROOT,
			'example/angular/services/cycle-a.ts'
		);
		const original = readFileSync(target, 'utf-8');

		try {
			// Delete the file. Importing page errors transiently.
			unlinkSync(target);
			// fs.watch fires; addFileToGraph for the removed file is
			// a no-op (file gone). Dependents now have a broken edge
			// to a non-existent target.
			await Bun.sleep(800);

			// Recreate with mutated content. The fix in
			// `dependencyGraph.ts`'s addFileToGraph walks every
			// known file's deps and reconnects any that named this
			// path — restoring the reverse-link.
			const next = original.replace(
				/'cycle-a-[A-Z0-9]+'/,
				"'cycle-a-RECREATED'"
			);
			writeFileSync(target, next, 'utf-8');

			// Wait for the rebuild debounce + bundle rebuild.
			await Bun.sleep(5_000);

			// Verify SSR sees the new value.
			const res = await fetch(`${server.baseUrl}/angular`);
			const html = await res.text();
			expect(html).toContain('cycle-a-RECREATED');
		} finally {
			// Ensure the file is restored even on assertion failure.
			if (!existsSync(target)) writeFileSync(target, original, 'utf-8');
			else writeFileSync(target, original, 'utf-8');
		}
	}, 60_000);
});
