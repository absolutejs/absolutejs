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
const sveltePage = resolve(
	PROJECT_ROOT,
	'example/svelte/pages/SvelteExample.svelte'
);
const angularComp = resolve(
	PROJECT_ROOT,
	'example/angular/components/counter.component.ts'
);

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

			// Sourcemaps land us back at the .vue source.
			// compileVue inlines compileScript's sourcemap (with a
			// blank-line remap to match Bun.Transpiler's output) on
			// the intermediate; Bun.build's `sourcemap: 'inline'`
			// emits a map from the final hashed bundle to the
			// intermediate; `chainBundleInlineSourcemap` composes the
			// chain post-build because Bun.build doesn't chain
			// through input inline sourcemaps yet
			// (BUN_SOURCEMAP_CHAIN_BUG.md). Together: stack frames
			// for SSR throws point at the .vue file.
			expect(trace).toMatch(/VueExample\.vue(?::\d+)?/);
		},
		60_000
	);

	test(
		'a thrown error in a Svelte SFC is logged with the throw site mapped to the .svelte source',
		async () => {
			const { client: c, server: srv } = await startAll();

			// Warm the pipeline.
			for (const marker of ['WARM_1', 'WARM_2']) {
				mutateFile(sveltePage, (text) =>
					text.replace(
						/<h1>AbsoluteJS \+ Svelte[^<]*<\/h1>/,
						`<h1>AbsoluteJS + Svelte ${marker}</h1>`
					)
				);
				await c.waitFor(
					'svelte-tier-zero-ssr-rebuild-complete',
					30_000
				);
			}
			c.drain();

			// Inject a throw at the top of the <script> block.
			const sentinel = `SOURCEMAP_SVELTE_${Date.now()}`;
			mutateFile(sveltePage, (text) =>
				text.replace(
					'<script lang="ts">',
					`<script lang="ts">\n\tthrow new Error('${sentinel}');`
				)
			);
			await c.waitFor('svelte-tier-zero-ssr-rebuild-complete', 30_000);

			const res = await fetch(`${srv.baseUrl}/svelte`);
			expect(res.status).toBeGreaterThanOrEqual(200);
			const body = await res.text();
			expect(body).toContain(sentinel);

			await new Promise((r) => setTimeout(r, 750));

			const block = collectSentinelOutput(srv.outputLines, sentinel, 30);
			expect(block).not.toBeNull();
			const trace = block!.join('\n');

			expect(trace).toContain(sentinel);
			expect(trace).toMatch(/at\s+\w[\w$]*\s+\([^)]+:\d+:\d+\)/);

			// Svelte's compile-emitted inline sourcemap, threaded through
			// Bun.build's output map by chainBundleInlineSourcemap, lands
			// the frame on the .svelte source.
			expect(trace).toMatch(/SvelteExample\.svelte(?::\d+)?/);
		},
		60_000
	);

	test(
		'a thrown error in an Angular component frame points at the on-disk intermediate JS',
		async () => {
			const { server: srv } = await startAll();

			const sentinel = `SOURCEMAP_NG_${Date.now()}`;
			mutateFile(angularComp, (text) =>
				text.replace(
					/(@Component\([^)]*\)\s*export\s+class\s+\w+\s*\{)/,
					`$1\n  constructor() { throw new Error('${sentinel}'); }`
				)
			);

			const deadline = Date.now() + 30_000;
			let body = '';
			while (Date.now() < deadline) {
				const res = await fetch(`${srv.baseUrl}/angular`);
				body = await res.text();
				if (body.includes(sentinel)) break;
				await new Promise((r) => setTimeout(r, 250));
			}
			expect(body).toContain(sentinel);

			await new Promise((r) => setTimeout(r, 750));

			const block = collectSentinelOutput(srv.outputLines, sentinel, 30);
			expect(block).not.toBeNull();
			const trace = block!.join('\n');

			expect(trace).toContain(sentinel);
			expect(trace).toMatch(/at\s+\w[\w$]*\s+\([^)]+:\d+:\d+\)/);

			// Angular SSR consumes compileAngular's per-file
			// intermediates directly (no Bun.build for the server
			// path). Bun.Transpiler doesn't emit sourcemaps and the
			// decorator-metadata rewrite reshapes the class body
			// aggressively enough that content-matching the
			// original .ts gives only trivial mappings — so the
			// frame currently lands on the on-disk intermediate
			// `.js` under `.absolutejs/generated/angular/...`. The
			// developer can still open and read that file; line
			// numbers won't match the `.ts` they edit. Tracked in
			// HMR_COVERAGE.md open issues as the next step
			// (switching to a per-file Bun.build pass would unlock
			// chainable sourcemaps for Angular).
			expect(trace).toMatch(
				/\.absolutejs[/\\]generated[/\\]angular[/\\].*counter\.component\.js/
			);
		},
		60_000
	);
});
