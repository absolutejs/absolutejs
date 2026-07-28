import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFilePollingFallback } from '../../../src/dev/serverEntryWatcher';

const tempDirs: string[] = [];

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		await rm(dir, { force: true, recursive: true });
	}
});

describe('server-entry polling fallback', () => {
	test('observes a missed write and stops cleanly', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-entry-poll-'));
		tempDirs.push(root);
		const entry = join(root, 'server.ts');
		await writeFile(entry, 'export const value = 1;');
		let changes = 0;
		const watcher = startFilePollingFallback(
			entry,
			() => {
				changes++;
			},
			20
		);

		await writeFile(entry, 'export const value = 200;');
		const deadline = Date.now() + 2_000;
		while (changes === 0 && Date.now() < deadline) {
			await Bun.sleep(20);
		}
		expect(changes).toBe(1);

		watcher.close();
		await writeFile(entry, 'export const value = 3000;');
		await Bun.sleep(60);
		expect(changes).toBe(1);
	});
});
