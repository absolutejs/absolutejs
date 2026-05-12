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

const startAll = async () => {
	server = await startDevServer();
	client = await connectHMR(server.port);
	await client.waitFor('manifest');
	await client.waitFor('connected');
	client.drain();
	return { client: client!, server: server! };
};

const collectSentinelOutput = (
	lines: readonly string[],
	sentinel: string,
	followLines = 40
) => {
	const idx = lines.findIndex((line) => line.includes(sentinel));
	if (idx === -1) return null;
	return lines.slice(idx, Math.min(lines.length, idx + followLines + 1));
};

/* Error-stack visibility snapshot for SSR throws.
 *
 * When a Vue SFC throws during SSR, the dev runtime catches the
 * error and renders `ssrErrorPage` to the browser, but the
 * underlying stack must also reach the developer's terminal —
 * that's where they pick up the actual frame information.
 *
 * This test asserts the BASELINE visibility contract:
 *   - The sentinel error message ends up in the dev server's
 *     stderr.
 *   - The error page rendered to the browser contains the
 *     message.
 *
 * The stack frames currently point at the compiled SSR JS under
 * `example/build/vue/server/pages/VueExample.<hash>.js`, NOT at
 * the original `VueExample.vue` source — Vue's SSR build output
 * is emitted without sourcemaps today. That's a documented DX
 * regression listed in HMR_COVERAGE.md's open-issues section.
 * Tightening this test to require the `.vue` path is the natural
 * follow-up once the Vue compile pipeline starts emitting inline
 * sourcemaps and Bun's runtime threads them through Error.stack.
 *
 * The visibility piece is the load-bearing assertion: if a future
 * change silently swallows SSR error logging (e.g., catches the
 * error without re-throwing or printing), the developer would
 * see only the rendered error page with no terminal trace —
 * exactly the silent-failure mode this snapshot prevents. */
describe('SSR error logging reaches dev-server stderr', () => {
	test(
		'a thrown error in a Vue SFC is logged with the throw site visible in stderr',
		async () => {
			const { client: c, server: srv } = await startAll();

			// Warm the pipeline so we're past cold-cache state.
			for (const marker of ['WARM_1', 'WARM_2']) {
				mutateFile(vuePage, (text) =>
					text.replace(
						/<h1>AbsoluteJS \+ Vue[^<]*<\/h1>/,
						`<h1>AbsoluteJS + Vue ${marker}</h1>`
					)
				);
				await c.waitFor('vue-tier-zero-ssr-rebuild-complete', 30_000);
			}
			c.drain();

			const sentinel = `SOURCEMAP_PROBE_${Date.now()}`;
			mutateFile(vuePage, (text) =>
				text.replace(
					'<script setup lang="ts">',
					`<script setup lang="ts">\nthrow new Error('${sentinel}');`
				)
			);
			await c.waitFor('vue-tier-zero-ssr-rebuild-complete', 30_000);

			const res = await fetch(`${srv.baseUrl}/vue`);
			expect(res.status).toBeGreaterThanOrEqual(200);
			const body = await res.text();
			expect(body).toContain(sentinel);

			// Give stderr a beat to flush.
			await new Promise((r) => setTimeout(r, 750));

			const block = collectSentinelOutput(srv.outputLines, sentinel, 30);
			expect(block).not.toBeNull();
			const trace = block!.join('\n');

			// Visibility contract: the sentinel and at least one
			// "at <fn> (<path>:<line>:<col>)" frame must appear in
			// stderr. Without that, errors disappear silently from
			// the developer's terminal.
			expect(trace).toContain(sentinel);
			expect(trace).toMatch(/at\s+\w[\w$]*\s+\([^)]+:\d+:\d+\)/);

			// The compiled-SSR build path currently shows up because
			// Vue's SSR compile pipeline doesn't emit sourcemaps
			// (HMR_COVERAGE.md "open issues"). When sourcemaps land
			// and stack frames map back to the .vue source, swap
			// this regex to require `VueExample.vue` instead.
			const sawBuildOutputFrame =
				/example[/\\]build[/\\]vue[/\\]server[/\\]pages[/\\]VueExample/.test(
					trace
				);
			expect(sawBuildOutputFrame).toBe(true);
		},
		60_000
	);
});
