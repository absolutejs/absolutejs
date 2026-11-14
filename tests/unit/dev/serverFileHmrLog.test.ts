import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BuildConfig } from '../../../types/build';
import { createHMRState } from '../../../src/dev/clientManager';
import { queueFileChange } from '../../../src/dev/rebuildTrigger';

/* One editor save reaches queueFileChange as several watcher events (the
 * atomic-rename recovery scans alone re-report it three times). A server
 * file outside every framework directory is handled inline, and its content
 * hash used to be recorded only after awaits, so every event logged
 * "[hmr] hmr update src/backend/api.ts" for the same save. */
describe('server file edits log one hmr update per save', () => {
	let root = '';

	afterEach(() => {
		if (root) rmSync(root, { force: true, recursive: true });
		root = '';
	});

	test('concurrent watcher events for one save log once', async () => {
		root = mkdtempSync(join(tmpdir(), 'server-file-hmr-log-'));
		mkdirSync(join(root, 'src', 'backend'), { recursive: true });
		mkdirSync(join(root, 'src', 'frontend'), { recursive: true });
		const apiFile = join(root, 'src', 'backend', 'api.ts');
		writeFileSync(apiFile, 'export const api = 1;\n');
		const config: BuildConfig = {
			buildDirectory: join(root, 'build'),
			reactDirectory: join(root, 'src', 'frontend')
		};
		const state = createHMRState(config);
		const log = spyOn(console, 'log').mockImplementation(() => undefined);
		try {
			const noop = () => undefined;
			await Promise.all([
				queueFileChange(state, apiFile, config, noop),
				queueFileChange(state, apiFile, config, noop),
				queueFileChange(state, apiFile, config, noop)
			]);
			const updates = log.mock.calls.filter((call) =>
				String(call[0]).includes('hmr update')
			);
			expect(updates).toHaveLength(1);

			// A later save with new content still logs.
			writeFileSync(apiFile, 'export const api = 2;\n');
			await Promise.all([
				queueFileChange(state, apiFile, config, noop),
				queueFileChange(state, apiFile, config, noop)
			]);
			expect(
				log.mock.calls.filter((call) =>
					String(call[0]).includes('hmr update')
				)
			).toHaveLength(2);
		} finally {
			log.mockRestore();
		}
	});
});
