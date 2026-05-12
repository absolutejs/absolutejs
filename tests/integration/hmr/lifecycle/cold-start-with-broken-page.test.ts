import { describe, expect, test, afterEach } from 'bun:test';
import { resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { mutateFile, restoreAllFiles } from '../../../helpers/file';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');

let server: DevServer | undefined;

afterEach(async () => {
	if (server) {
		await server.kill();
		server = undefined;
	}
	restoreAllFiles();
});

const vuePage = resolve(PROJECT_ROOT, 'example/vue/pages/VueExample.vue');

/* Snapshot of current cold-start behaviour when a user has an
 * initial build-time error in any framework page. The dev server's
 * initial `build()` pass runs with `throwOnError: true`; the broken
 * page makes the whole pass fail, the bun child exits before
 * reaching `Bun.serve`, and `/hmr-status` never responds. The user
 * sees a single error in stderr and a dead terminal — they have to
 * fix the syntax error without any live-reload feedback.
 *
 * This is a documented DX gap (see HMR_COVERAGE.md open issues).
 * The cleaner future behaviour is: come up anyway, serve a
 * cold-start error page on the broken route, keep the file watcher
 * alive, and recover once the user fixes the file — same shape as
 * the mid-session build-error recovery already tested by
 * `cross-cutting-reliability.test.ts`. When that lands, this test
 * will start passing the wrong way (boot succeeds where we
 * currently expect failure) and the assertion should be inverted
 * to lock in the new contract. */
describe('cold-start with a syntax error in one page (current behaviour)', () => {
	test(
		'dev server fails to start when an initial page has a build-time syntax error',
		async () => {
			mutateFile(vuePage, (text) =>
				text.replace(
					"import { ref } from 'vue';",
					"import { ref } from 'vue THIS_IS_BROKEN'"
				)
			);

			let bootError: unknown = null;
			try {
				// Short retry budget — we expect failure and don't
				// want to eat the default 60s timeout.
				server = await startDevServer({ bootMaxRetries: 16 });
			} catch (err) {
				bootError = err;
			}

			expect(bootError).not.toBeNull();
			expect(
				bootError instanceof Error ? bootError.message : String(bootError)
			).toMatch(/did not become ready|Server build failed/);
		},
		30_000
	);
});
