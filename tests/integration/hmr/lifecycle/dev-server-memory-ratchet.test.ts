import { describe, expect, test, afterEach } from 'bun:test';
import { readFileSync } from 'node:fs';
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

const rssKb = (pid: number) => {
	const status = readFileSync(`/proc/${pid}/status`, 'utf-8');
	const match = status.match(/^VmRSS:\s+(\d+)\s+kB/m);
	if (!match) {
		throw new Error(`Could not parse VmRSS from /proc/${pid}/status`);
	}
	return Number(match[1]);
};

/* Sibling-copy Path B (serverEntryWatcher.ts) allocates a fresh
 * module record on every entry edit. Bun's `--hot` similarly
 * tracks state per module across edits. A leak in either layer
 * would surface over a long-running dev session as steady RSS
 * growth; a loose RSS ratchet test gives us a cheap regression
 * signal before users hit the OOM that ends the 30-minute coding
 * session.
 *
 * The bound is INTENTIONALLY loose — we expect honest growth
 * during the first dozen edits (manifest warming, dep-graph
 * population, Bun's own JIT/code caches) and want to catch only
 * an unbounded leak. 3× the warmed baseline is the threshold:
 * a real leak from per-edit retained module records would blow
 * past that within 100 cycles; transient noise would not.
 *
 * Linux-only (reads /proc/<pid>/status). On macOS/Windows the
 * test reports `skip` rather than fail. */
describe('dev-server RSS does not grow unboundedly over many HMR cycles', () => {
	test(
		'100 Vue template edits stay within 3x the warmed RSS baseline',
		async () => {
			if (process.platform !== 'linux') {
				console.warn(
					`[skip] /proc-based RSS check requires Linux (current: ${process.platform})`
				);
				return;
			}

			const { client: c, server: srv } = await startAll();

			// Warmup phase: 10 edits to fill manifest, prime caches,
			// settle Bun's JIT and module-record allocation profile.
			// We sample the post-warmup RSS as the baseline so this
			// test isn't measuring "cold start to warmed dev session"
			// growth, which is fine and expected.
			for (let i = 0; i < 10; i++) {
				const marker = `WARMUP_${i}`;
				mutateFile(vuePage, (text) =>
					text.replace(
						/<h1>AbsoluteJS \+ Vue[^<]*<\/h1>/,
						`<h1>AbsoluteJS + Vue ${marker}</h1>`
					)
				);
				await c.waitFor('vue-tier-zero-ssr-rebuild-complete', 15_000);
				c.drain();
			}

			// Settle and snapshot baseline.
			await new Promise((r) => setTimeout(r, 1_000));
			const baselineRss = rssKb(srv.proc.pid);

			// 100 more edits. We don't drain the client every loop —
			// some events may pile up in the WS buffer, but waitFor's
			// snapshot/skip semantics keep that bounded.
			for (let i = 0; i < 100; i++) {
				const marker = `RATCHET_${i}`;
				mutateFile(vuePage, (text) =>
					text.replace(
						/<h1>AbsoluteJS \+ Vue[^<]*<\/h1>/,
						`<h1>AbsoluteJS + Vue ${marker}</h1>`
					)
				);
				await c.waitFor('vue-tier-zero-ssr-rebuild-complete', 15_000);
				if (i % 10 === 9) c.drain();
			}

			await new Promise((r) => setTimeout(r, 1_000));
			const finalRss = rssKb(srv.proc.pid);

			const ratio = finalRss / baselineRss;
			console.log(
				`[memory-ratchet] baseline=${baselineRss}kB final=${finalRss}kB ratio=${ratio.toFixed(2)}x`
			);

			// Loose bound: 3× the warmed baseline. A real per-edit
			// retain would blow past this; transient JIT/code-cache
			// drift would not.
			expect(ratio).toBeLessThan(3);

			// SSR must still work — a leak that leaves the server
			// alive but unable to render is also a regression. Vue's
			// SSR import cache can lag the final HMR cycle by a
			// beat, so we accept the last few markers as evidence
			// the pipeline is still alive.
			const finalRender = await (
				await fetch(`${srv.baseUrl}/vue`)
			).text();
			const sawRecentMarker = /RATCHET_(?:9[5-9])/.test(finalRender);
			expect(sawRecentMarker).toBe(true);
		},
		300_000
	);
});
