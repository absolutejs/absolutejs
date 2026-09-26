import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHMRState } from '../../../src/dev/clientManager';
import { addFileWatchers } from '../../../src/dev/fileWatcher';
import { isAbsoluteServerEntryCopyPath } from '../../../src/dev/serverEntryCopies';

test('generated snapshot detection handles recursive and Windows watch paths', () => {
	for (const path of [
		'.absolutejs-hmr-12-0.ts',
		'backend/.absolutejs-hmr-12-bootstrap-2.ts',
		'src\\backend\\.absolutejs-hmr-12-0.ts'
	])
		expect(isAbsoluteServerEntryCopyPath(path)).toBe(true);
	for (const path of [
		'backend/server.ts',
		'absolute.config.ts',
		'backend/not.absolutejs-hmr.ts'
	])
		expect(isAbsoluteServerEntryCopyPath(path)).toBe(false);
});

test('nested snapshots do not trigger HMR or atomic recovery; real edits still do', async () => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-generated-watch-'));
	const nested = join(root, 'backend');
	await mkdir(nested);
	const source = join(nested, 'server.ts');
	await writeFile(source, 'export const value = 1;');
	const state = createHMRState({ reactDirectory: root });
	const changes: string[] = [];
	try {
		addFileWatchers(state, [root], (path) => {
			changes.push(path);
		});
		await writeFile(
			join(nested, '.absolutejs-hmr-123-bootstrap-2.ts'),
			'export const temporary = 1;'
		);
		await Bun.sleep(200);
		expect(changes).toEqual([]);
		await writeFile(source, 'export const value = 2;');
		const deadline = Date.now() + 2000;
		while (!changes.includes(source) && Date.now() < deadline)
			await Bun.sleep(20);
		expect(changes).toContain(source);
	} finally {
		for (const watcher of state.watchers) watcher.close();
		await rm(root, { force: true, recursive: true });
	}
});
