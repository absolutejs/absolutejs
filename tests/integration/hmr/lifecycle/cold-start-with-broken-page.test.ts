import { describe, expect, test, afterEach } from 'bun:test';
import { resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { connectHMR, type HMRClient } from '../../../helpers/ws';
import { mutateFile, restoreAllFiles } from '../../../helpers/file';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');

let server: DevServer | undefined;
let client: HMRClient | undefined;

afterEach(async () => {
	client?.close();
	client = undefined;
	if (server) {
		await server.kill();
		server = undefined;
	}
	restoreAllFiles();
});

const vuePage = resolve(PROJECT_ROOT, 'example/vue/pages/VueExample.vue');

/* Cold-start build-error recovery contract.
 *
 * When the user's initial `bun run dev` runs against a source tree
 * with a build-time syntax error anywhere, the dev server still
 * binds its port, `/hmr-status` still responds, the WS handshake
 * still completes, and the file watcher still runs — so the user
 * gets live-reload feedback for the fix.
 *
 * The broken route itself returns 5xx (manifest is empty for that
 * page) until a successful rebuild populates it. Other framework
 * pages that DIDN'T have errors are part of the same all-or-nothing
 * Bun.build pass and also won't have manifest entries until the
 * recovery rebuild — so they 5xx too on cold-start. The contract is
 * "dev server alive + live-reload working", not "partial routes
 * still serve." Once the user saves a fix, `rebuildManifest`
 * converges and all routes come up.
 *
 * Mirrors the mid-session build-error recovery already covered by
 * `cross-cutting-reliability.test.ts` — the same shape, just
 * starting from a broken initial state. */
describe('cold-start with a syntax error recovers to a healthy dev server', () => {
	test(
		'dev server boots with an empty manifest; fixing the file converges',
		async () => {
			mutateFile(vuePage, (text) =>
				text.replace(
					"import { ref } from 'vue';",
					"import { ref } from 'vue THIS_IS_BROKEN'"
				)
			);

			server = await startDevServer();

			// Supervisor liveness.
			expect(
				(await fetch(`${server.baseUrl}/hmr-status`)).status
			).toBe(200);

			// WS handshake completes — file watcher is alive.
			client = await connectHMR(server.port);
			await client.waitFor('manifest');
			await client.waitFor('connected');
			client.drain();

			// Now fix the broken file. The mid-session rebuild
			// path picks it up and the route starts working.
			restoreAllFiles();
			mutateFile(vuePage, (text) =>
				text.replace(
					/<h1>AbsoluteJS \+ Vue[^<]*<\/h1>/,
					'<h1>AbsoluteJS + Vue COLD_START_RECOVERED</h1>'
				)
			);

			// Don't require a specific HMR event — recovery from a
			// build-error state in Vue may surface via different
			// signals depending on which fast path runs. Poll the
			// SSR endpoint instead.
			const deadline = Date.now() + 60_000;
			let recovered = false;
			let lastBody = '';
			let lastStatus = 0;
			while (Date.now() < deadline) {
				const res = await fetch(`${server.baseUrl}/vue`);
				lastStatus = res.status;
				lastBody = await res.text();
				if (lastBody.includes('COLD_START_RECOVERED')) {
					recovered = true;
					break;
				}
				await new Promise((r) => setTimeout(r, 300));
			}
			if (!recovered) {
				console.error(
					`[recovery-debug] last status: ${lastStatus} body: ${lastBody.slice(0, 300)}\nrecent ws events: ${client?.messages
						.slice(-15)
						.map((m) => m.type)
						.join(', ')}\nlast 50 server lines:\n${server.outputLines.slice(-50).join('\n')}\n` +
						`manifest keys via server log:\n` +
						`(see [recovery-debug] above)`
				);
			}
			expect(recovered).toBe(true);
		},
		120_000
	);
});
