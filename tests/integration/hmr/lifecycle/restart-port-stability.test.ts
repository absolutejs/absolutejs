import { describe, expect, test, afterEach } from 'bun:test';
import { resolve } from 'node:path';
import { mutateFile, restoreAllFiles } from '../../../helpers/file';
import { getAvailablePort } from '../../../helpers/ports';
import { waitForServer } from '../../../helpers/http';

type LineWaiter = { pattern: RegExp; resolve: () => void };

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');
const serverEntry = resolve(PROJECT_ROOT, 'example/server.ts');
const configPath = resolve(PROJECT_ROOT, 'example/absolute.config.ts');
const cliEntry = resolve(PROJECT_ROOT, 'src/cli/index.ts');
// A harmless root-level file in the server-entry dir. Editing it trips the
// parent CLI's project-root watcher → `scheduleServerRestart` → a real child
// respawn, without corrupting config/build (so the replacement boots cleanly).
const restartTrigger = resolve(PROJECT_ROOT, 'example/vueImporter.ts');

let proc: ReturnType<typeof Bun.spawn> | undefined;

afterEach(async () => {
	if (proc) {
		try {
			proc.kill();
		} catch {
			/* already dead */
		}
		await proc.exited;
		proc = undefined;
	}
	restoreAllFiles();
});

/* Regression guard for the parent-CLI restart path (`restartServer` in
 * src/cli/scripts/dev.ts). The fix terminates the old bun child and WAITS for
 * it to release the port BEFORE spawning the replacement, and uses an
 * `intentionalRestart` flag so the exit monitor doesn't race a competing
 * crash-respawn. Two failure modes this pins:
 *
 *   1. Restart hangs — the deliberate kill is mistaken for a crash and the
 *      monitor respawns a competing child, so `restartServer` never finishes
 *      ("Server restarted." never prints). This reproduces deterministically.
 *   2. Port drift — spawning the replacement before the old child frees the
 *      port lets the new child slide to the next port in the range while the
 *      old one lingers serving stale code. The drift itself is timing-
 *      dependent (a busy/slow app exposes it; the lean example often doesn't),
 *      but the post-condition is pinned: every boot banner reports the SAME
 *      port and the server is healthy there after the restart.
 *
 * Discriminator: every `Local: http://localhost:<port>/` banner (initial boot
 * + post-restart boot) must report the original port, and `/hmr-status` must
 * be healthy on it after the restart. */
describe('parent CLI restart rebinds the original port (no zombie / no drift)', () => {
	test('[abs:restart] respawns the child on the SAME port and stays healthy', async () => {
		// The dev command reads its port from ABSOLUTE_PORT/PORT (not a CLI
		// flag). Pin a unique free port + portRange:1 so a clean boot lands
		// exactly there and the bug (new child can't rebind it → drifts) is
		// unambiguous in the banner.
		const port = await getAvailablePort();
		proc = Bun.spawn(
			[
				'bun',
				'run',
				cliEntry,
				'dev',
				serverEntry,
				'--config',
				configPath
			],
			{
				cwd: PROJECT_ROOT,
				env: {
					...process.env,
					ABSOLUTE_PORT: String(port),
					ABSOLUTE_PORT_RANGE: '20',
					FORCE_COLOR: '0',
					NODE_ENV: 'development',
					PORT: String(port),
					TELEMETRY_OFF: '1'
				},
				stderr: 'pipe',
				stdout: 'pipe'
			}
		);

		const outputLines: string[] = [];
		const waiters: LineWaiter[] = [];
		const recordLine = (line: string) => {
			outputLines.push(line);
			for (let i = waiters.length - 1; i >= 0; i--) {
				const entry = waiters[i];
				if (entry && entry.pattern.test(line)) {
					waiters.splice(i, 1);
					entry.resolve();
				}
			}
		};
		const drainStream = async (
			stream: ReadableStream<Uint8Array> | null
		) => {
			if (!stream) return;
			const reader = stream.getReader();
			const decoder = new TextDecoder();
			let buf = '';
			while (true) {
				const { done, value } = await reader.read();
				if (done) return;
				buf += decoder.decode(value, { stream: true });
				let idx;
				while ((idx = buf.indexOf('\n')) !== -1) {
					recordLine(buf.slice(0, idx));
					buf = buf.slice(idx + 1);
				}
			}
		};
		void drainStream(proc.stdout as ReadableStream<Uint8Array> | null);
		void drainStream(proc.stderr as ReadableStream<Uint8Array> | null);

		const waitForLine = (pattern: RegExp, timeoutMs: number) => {
			if (outputLines.some((line) => pattern.test(line))) {
				return Promise.resolve();
			}

			const {
				promise,
				resolve: resolveLine,
				reject: rejectLine
			} = Promise.withResolvers<void>();
			const waiter: LineWaiter = { pattern, resolve: resolveLine };
			const timer = setTimeout(() => {
				const idx = waiters.indexOf(waiter);
				if (idx !== -1) waiters.splice(idx, 1);
				rejectLine(
					new Error(
						`Timed out waiting for ${pattern} after ${timeoutMs}ms. Last 20 lines:\n${outputLines.slice(-20).join('\n')}`
					)
				);
			}, timeoutMs);
			waiter.resolve = () => {
				clearTimeout(timer);
				resolveLine();
			};
			waiters.push(waiter);

			return promise;
		};

		// Boot.
		await waitForServer(`http://localhost:${port}/hmr-status`);

		// Trigger a parent-CLI restart by editing a root-level file the
		// project-root watcher tracks (a no-op trailing comment keeps the
		// module valid so the replacement child boots normally).
		mutateFile(
			restartTrigger,
			(c) => `${c}\n// restart-port-stability test trigger\n`
		);

		await waitForLine(/Server restarted\./, 40_000);

		// The replacement child must be healthy on the ORIGINAL port. With
		// the bug the original port is held by the lingering old child (or
		// nothing rebinds it), and the new child is elsewhere.
		await waitForServer(`http://localhost:${port}/hmr-status`, 40);

		// Both the initial and post-restart boot banners must report the same
		// port — no drift to the next port in the range. Strip ANSI first.
		const ansiPattern = new RegExp(
			`${String.fromCharCode(27)}\\[[0-9;]*m`,
			'g'
		);
		const stripAnsi = (line: string) => line.replace(ansiPattern, '');
		const localPorts = outputLines
			.map(stripAnsi)
			.filter((line) => /Local:\s*https?:\/\/localhost:\d+/.test(line))
			.map((line) => line.match(/localhost:(\d+)/)?.[1]);
		// Initial boot + post-restart boot → at least two banners, all on the
		// SAME (original) port. Under the bug the post-restart banner drifts.
		expect(localPorts.length).toBeGreaterThanOrEqual(2);
		for (const bannerPort of localPorts) {
			expect(bannerPort).toBe(String(port));
		}

		expect(outputLines.some((line) => /Restart failed/.test(line))).toBe(
			false
		);
	}, 90_000);
});
