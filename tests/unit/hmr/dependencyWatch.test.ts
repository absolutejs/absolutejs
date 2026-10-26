import type { BuildConfig } from '../../../types/build';
import { expect, test } from 'bun:test';
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	renameSync,
	unlinkSync,
	rmSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHMRState } from '../../../src/dev/clientManager';
import { startFileWatching } from '../../../src/dev/fileWatcher';

test('dependency manifests and lockfiles remain watched without recursive root watching', async () => {
	const prior = process.cwd(),
		root = mkdtempSync(join(tmpdir(), 'absolute-dependency-watch-'));
	const config: BuildConfig = {
		dev: { autoWatchDirectories: false },
		reactDirectory: 'src/react'
	};
	let state: ReturnType<typeof createHMRState> | undefined;
	const changes: string[] = [];
	const waitFor = async (file: string) => {
		const deadline = Date.now() + 2000;
		while (!changes.includes(join(root, file)) && Date.now() < deadline)
			await Bun.sleep(10);
		expect(changes).toContain(join(root, file));
		changes.length = 0;
	};
	try {
		for (const dir of ['src/react', 'docs', 'node_modules/demo'])
			mkdirSync(join(root, dir), { recursive: true });
		writeFileSync(join(root, 'package.json'), '{}');
		process.chdir(root);
		state = createHMRState(config);
		startFileWatching(state, config, (file) => changes.push(file));
		writeFileSync(
			join(root, 'package.json'),
			'{"dependencies":{"demo":"1.0.0"}}'
		);
		await waitFor('package.json');
		writeFileSync(join(root, 'bun.lock'), 'first install');
		await waitFor('bun.lock');
		writeFileSync(join(root, 'package.json.tmp'), '{}');
		renameSync(join(root, 'package.json.tmp'), join(root, 'package.json'));
		await waitFor('package.json');
		unlinkSync(join(root, 'bun.lock'));
		await waitFor('bun.lock');
		writeFileSync(join(root, 'bun.lock'), 'reinstalled');
		await waitFor('bun.lock');
		writeFileSync(join(root, 'docs', 'large-report.json'), '{}');
		writeFileSync(
			join(root, 'node_modules/demo/index.js'),
			'export default 1'
		);
		await Bun.sleep(200);
		expect(
			changes.filter(
				(p) => p.includes('/docs/') || p.includes('/node_modules/')
			)
		).toEqual([]);
	} finally {
		for (const watcher of state?.watchers ?? []) watcher.close();
		process.chdir(prior);
		rmSync(root, { force: true, recursive: true });
	}
});
