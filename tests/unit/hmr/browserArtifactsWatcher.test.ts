import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHMRState } from '../../../src/dev/clientManager';
import { addFileWatchers } from '../../../src/dev/fileWatcher';

test('browser recordings and atomic trace writes never enter the rebuild queue', async () => {
	const root = mkdtempSync(join(tmpdir(), 'absolute-browser-artifacts-'));
	const state = createHMRState({ buildDirectory: join(root, 'build') });
	const changes: string[] = [];
	try {
		addFileWatchers(state, [root], (path) => changes.push(path));
		for (const directory of [
			'test-results',
			'playwright-report',
			'blob-report',
			'.playwright-mcp'
		]) {
			const output = join(root, directory);
			mkdirSync(output);
			writeFileSync(join(output, 'frame.jpeg'), 'screenshot');
			writeFileSync(join(output, 'index.html'), 'report');
			writeFileSync(join(output, 'trace.tmp'), 'atomic trace write');
		}
		const source = join(root, 'app.ts');
		writeFileSync(source, 'export const value = 1;');
		const deadline = Date.now() + 3000;
		while (!changes.includes(source) && Date.now() < deadline)
			await Bun.sleep(20);
		expect(changes).toContain(source);
		// Include the watcher's delayed atomic-write recovery passes (25/100ms).
		await Bun.sleep(200);
		expect(changes.every((path) => path === source)).toBe(true);
	} finally {
		for (const watcher of state.watchers) watcher.close();
		rmSync(root, { force: true, recursive: true });
	}
});
