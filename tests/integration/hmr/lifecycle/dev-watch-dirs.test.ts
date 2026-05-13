import { describe, expect, test, afterEach } from 'bun:test';
import { resolve, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
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

/* `dev.watchDirs` lets the user point the file watcher at extra
 * directories outside the configured framework dirs (e.g. a shared
 * `src/backend/` tree). Edits to those files must propagate through
 * the same HMR pipeline as edits inside a framework dir.
 *
 * Verified by: configure `dev.watchDirs` to include a sentinel
 * directory, create a file there, start the dev server (so the
 * watcher boots with the dir attached), then edit the file and
 * observe the framework's `hmr update` log line on stdout — which
 * only fires when the watcher actually saw the edit. The marker
 * being absent would mean the path wasn't watched. */
describe('dev.watchDirs extra paths fire HMR', () => {
	test('edit inside a `dev.watchDirs` path triggers the file watcher', async () => {
		const watchedDir = resolve(
			PROJECT_ROOT,
			'example/.dev-watch-dirs-fixture'
		);
		mkdirSync(watchedDir, { recursive: true });
		const watchedFile = resolve(watchedDir, 'sentinel.ts');
		createFile(
			watchedFile,
			`// Initial fixture content; HMR target for dev.watchDirs test.\nexport const sentinel = 0;\n`
		);

		// Splice `dev.watchDirs` into the example config. Watcher
		// boots with the configured paths, so it has to be there
		// before the dev server starts.
		const configPath = resolve(PROJECT_ROOT, 'example/absolute.config.ts');
		mutateFile(configPath, (c) =>
			c.replace(
				"angularDirectory: 'example/angular',",
				"angularDirectory: 'example/angular',\n\tdev: { watchDirs: ['example/.dev-watch-dirs-fixture'] },"
			)
		);

		server = await startDevServer();

		// Mutate the watched file. The watcher emits an `hmr update`
		// log line on stdout for every detected file change inside
		// any watched root — regardless of which framework it
		// belongs to.
		mutateFile(watchedFile, (c) =>
			c.replace(
				'export const sentinel = 0;',
				'export const sentinel = 1;'
			)
		);

		await server.waitForOutput(/hmr update.*sentinel\.ts/);
	}, 30_000);
});
