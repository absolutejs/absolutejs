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

	return { client: client, server: server };
};

const rssKb = (pid: number) => {
	const status = readFileSync(`/proc/${pid}/status`, 'utf-8');
	const match = status.match(/^VmRSS:\s+(\d+)\s+kB/m);
	if (!match) {
		throw new Error(`Could not parse VmRSS from /proc/${pid}/status`);
	}

	return Number(match[1]);
};

const extractVueMarker = (text: string) =>
	text.match(/<h1>AbsoluteJS \+ Vue ([^<]+)<\/h1>/)?.[1] ?? '<missing>';

const waitForVueMarker = async (srv: DevServer, marker: string) => {
	const deadline = Date.now() + 30_000;
	let lastRender = '';
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`${srv.baseUrl}/vue`);
			lastRender = await response.text();
			if (lastRender.includes(marker)) return;
		} catch {
			// The atomic server bundle swap may briefly overlap this probe.
		}
		await Bun.sleep(50);
	}

	let hmrStatus = '<unavailable>';
	try {
		hmrStatus = await (await fetch(`${srv.baseUrl}/hmr-status`)).text();
	} catch {
		// Best-effort timeout diagnostics.
	}
	const source = readFileSync(vuePage, 'utf8');
	throw new Error(
		[
			`Vue SSR did not converge on ${marker} within 30000ms`,
			`source marker: ${extractVueMarker(source)}`,
			`rendered marker: ${extractVueMarker(lastRender)}`,
			`hmr status: ${hmrStatus}`,
			`last server output:\n${srv.outputLines.slice(-60).join('\n')}`
		].join('\n')
	);
};

const waitForVueCycle = async (
	c: HMRClient,
	srv: DevServer,
	marker: string
) => {
	try {
		// The surgical client update is the operation this ratchet stresses and
		// normally arrives in milliseconds. A loaded integration shard can drop a
		// diagnostic socket frame; in that case, fall back to the authoritative
		// rendered SSR result instead of failing a healthy rebuild.
		await c.waitFor('vue-update', 5_000);
	} catch {
		await waitForVueMarker(srv, marker);
	}
};

/* Sibling-copy Path B (serverEntryWatcher.ts) allocates a fresh
 * module record on every entry edit. Bun also tracks runtime state
 * per module across edits. A leak in either layer
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
	test('100 Vue template edits stay within 3x the warmed RSS baseline', async () => {
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
			await waitForVueCycle(c, srv, marker);
			c.drain();
		}

		// Settle and snapshot baseline.
		await new Promise((_resolve) => setTimeout(_resolve, 1_000));
		const baselineRss = rssKb(srv.proc.pid);

		// 100 more edits. The rendered SSR result is authoritative; the
		// WebSocket event is diagnostic and can be lost when a loaded shard
		// reconnects. Drain diagnostics every cycle so they cannot influence the
		// server RSS measurement.
		for (let i = 0; i < 100; i++) {
			const marker = `RATCHET_${i}`;
			mutateFile(vuePage, (text) =>
				text.replace(
					/<h1>AbsoluteJS \+ Vue[^<]*<\/h1>/,
					`<h1>AbsoluteJS + Vue ${marker}</h1>`
				)
			);
			await waitForVueCycle(c, srv, marker);
			c.drain();
		}

		await new Promise((_resolve) => setTimeout(_resolve, 1_000));
		const finalRss = rssKb(srv.proc.pid);

		const ratio = finalRss / baselineRss;
		console.log(
			`[memory-ratchet] baseline=${baselineRss}kB final=${finalRss}kB ratio=${ratio.toFixed(2)}x`
		);

		// Loose bound: 3× the warmed baseline. A real per-edit
		// retain would blow past this; transient JIT/code-cache
		// drift would not.
		expect(ratio).toBeLessThan(3);

		// SSR must converge on the exact final edit too — a fast client pipeline
		// that leaves new requests on stale server bytes is still broken.
		await waitForVueMarker(srv, 'RATCHET_99');
		const finalRender = await (await fetch(`${srv.baseUrl}/vue`)).text();
		expect(finalRender).toContain('RATCHET_99');
	}, 900_000);
});
