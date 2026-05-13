import { describe, expect, test, afterEach } from 'bun:test';
import { resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { mutateFile, restoreAllFiles } from '../../../helpers/file';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');
const CONFIG = resolve(PROJECT_ROOT, 'example/absolute.config.ts');

let server: DevServer | undefined;

afterEach(async () => {
	if (server) {
		await server.kill();
		server = undefined;
	}
	// Restoration runs AFTER the server's gone so the live watcher
	// can't observe the cleanup edits as another change event.
	restoreAllFiles();
});

/* When a config change can't be applied in-place from inside the
 * dev child process, the framework emits an `[abs:restart] <path>`
 * marker on stdout. The parent CLI watches for this line and
 * respawns the child against the updated config.
 *
 * Each branch of `serverEntryWatcher.triggerConfigChange` is
 * exercised in isolation — the watcher debounces same-cause events
 * within 100ms, so we use a fresh dev server per case to avoid
 * leaking state between checks. */
describe('[abs:restart] stdout marker fires on non-applicable config changes', () => {
	test('non-framework key edit (`buildDirectory`) emits [abs:restart] with "non-framework keys" log', async () => {
		server = await startDevServer();
		mutateFile(CONFIG, (c) =>
			c.replace(
				"buildDirectory: 'example/build'",
				"buildDirectory: 'example/build_tmp_restart_marker'"
			)
		);
		const log = await server.waitForOutput(
			/\[hmr\] absolute\.config\.ts changed \(non-framework keys\)/
		);
		expect(log).toContain('non-framework keys');
		await server.waitForOutput(/\[abs:restart\] .*absolute\.config\.ts/);
	}, 30_000);

	test('framework-dir rename emits [abs:restart] with "removed framework(s)" log', async () => {
		server = await startDevServer();
		// Renaming a framework dir is the cleanest way to exercise
		// the removal path without breaking the live example: the
		// diff sees `removed: ['react']` + `added: ['react']` and
		// the watcher takes the "removed framework(s)" branch first
		// (which already short-circuits with a restart marker). The
		// parser uses a regex that finds the directive even inside
		// comments, so we can't just `//`-out the line — we have to
		// actually change the string literal value.
		mutateFile(CONFIG, (c) =>
			c.replace(
				"reactDirectory: 'example/react',",
				"reactDirectory: 'example/react_renamed_tmp',"
			)
		);
		const log = await server.waitForOutput(
			/\[hmr\] absolute\.config\.ts removed framework\(s\)/
		);
		expect(log).toContain('react');
		await server.waitForOutput(/\[abs:restart\] .*absolute\.config\.ts/);
	}, 30_000);
});
