import { expect, test } from 'bun:test';
import type { BuildConfig } from '../../../types/build';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getWatchPaths } from '../../../src/dev/pathUtils';
import { createHMRState } from '../../../src/dev/clientManager';
import { addFileWatchers } from '../../../src/dev/fileWatcher';

test('opt out of automatic root directories while retaining explicit and source roots', async () => {
	const prior = process.cwd(),
		root = mkdtempSync(join(tmpdir(), 'absolute-watch-scope-'));
	const config: BuildConfig = {
		assetsDirectory: 'media',
		dev: { autoWatchDirectories: false, watchDirs: ['tools/shared'] },
		reactDirectory: 'app/react'
	};
	let state: ReturnType<typeof createHMRState> | undefined;
	try {
		for (const dir of [
			'src',
			'db',
			'assets',
			'styles',
			'app/react',
			'media',
			'tools/shared',
			'docs',
			'artifacts'
		])
			mkdirSync(join(root, dir), { recursive: true });
		process.chdir(root);
		const defaults = getWatchPaths({});
		expect(defaults).toContain(join(root, 'docs'));
		expect(defaults).toContain(join(root, 'artifacts'));
		expect(
			getWatchPaths({ dev: { autoWatchDirectories: true } })
		).toContain(join(root, 'docs'));
		const paths = getWatchPaths(config);
		for (const dir of [
			'src',
			'db',
			'assets',
			'styles',
			'app/react',
			'media',
			'tools/shared'
		])
			expect(paths).toContain(join(root, dir));
		expect(paths).not.toContain(join(root, 'docs'));
		expect(paths).not.toContain(join(root, 'artifacts'));
		// Opting a non-source directory back in remains explicit and deterministic.
		expect(
			getWatchPaths({
				dev: { autoWatchDirectories: false, watchDirs: ['docs'] }
			})
		).toContain(join(root, 'docs'));
		state = createHMRState(config);
		const changes: string[] = [];
		addFileWatchers(state, paths, (file) => changes.push(file));
		for (const dir of ['docs', 'artifacts'])
			writeFileSync(join(root, dir, 'report.json'), '{}');
		const expected = [
			'src/update.ts',
			'app/react/component.tsx',
			'tools/shared/helper.ts'
		].map((file) => join(root, file));
		for (const file of expected)
			writeFileSync(file, 'export const updated = true;');
		const deadline = Date.now() + 3000;
		while (
			expected.some((file) => !changes.includes(file)) &&
			Date.now() < deadline
		)
			await Bun.sleep(20);
		for (const file of expected) expect(changes).toContain(file);
		await Bun.sleep(200);
		expect(
			changes.some(
				(file) =>
					file.includes('/docs/') || file.includes('/artifacts/')
			)
		).toBe(false);
	} finally {
		for (const watcher of state?.watchers ?? []) watcher.close();
		process.chdir(prior);
		rmSync(root, { force: true, recursive: true });
	}
});
