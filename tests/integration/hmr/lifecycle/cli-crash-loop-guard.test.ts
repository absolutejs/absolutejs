import { describe, expect, test, afterEach } from 'bun:test';
import { resolve } from 'node:path';
import { mutateFile, restoreAllFiles } from '../../../helpers/file';
import { getAvailablePort } from '../../../helpers/ports';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');
const serverEntry = resolve(PROJECT_ROOT, 'example/server.ts');
const configPath = resolve(PROJECT_ROOT, 'example/absolute.config.ts');
const cliEntry = resolve(PROJECT_ROOT, 'src/cli/index.ts');

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

/* The parent `absolute dev` CLI in `src/cli/scripts/dev.ts` respawns
 * the bun child whenever it exits with a non-zero code. To stop the
 * terminal from being spammed by a tight crash loop, a rolling 10s
 * window caps the respawn rate at 5 crashes. Once exceeded, the CLI
 * prints a single explanatory message and exits with code 1,
 * leaving the user's terminal scrollable to find the original error.
 *
 * Note on crash triggering: `bun --hot` keeps the child process
 * alive even when the entry throws at top-level or has a syntax
 * error — it stays running waiting for file changes. So in
 * practice the crash-loop guard fires for *hard* exit modes (port
 * bind failure, explicit `process.exit(N)`, panics that bun can't
 * recover from). This test uses `process.exit(7)` injected at the
 * top of `server.ts` to deterministically simulate a hard crash on
 * every spawn. */
describe('CLI crash-loop guard refuses to restart after N rapid crashes', () => {
	test('broken server.ts → CLI respawns until the 10s window guard fires, prints `refusing to restart`, exits', async () => {
		// Pre-break server.ts to a hard exit. The bun child
		// will `process.exit(7)` on every spawn; the CLI will
		// catch the exit, respawn, exit, repeat — until the
		// guard fires.
		mutateFile(serverEntry, (text) =>
			text.replace(/^/, 'process.exit(7);\n')
		);

		const port = await getAvailablePort();
		proc = Bun.spawn(
			[
				'bun',
				'run',
				cliEntry,
				'dev',
				serverEntry,
				'--config',
				configPath,
				'--port',
				String(port)
			],
			{
				cwd: PROJECT_ROOT,
				env: {
					...process.env,
					FORCE_COLOR: '0',
					NODE_ENV: 'development',
					TELEMETRY_OFF: '1'
				},
				stderr: 'pipe',
				stdout: 'pipe'
			}
		);

		const outputLines: string[] = [];
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
					outputLines.push(buf.slice(0, idx));
					buf = buf.slice(idx + 1);
				}
			}
		};
		void drainStream(proc.stdout as ReadableStream<Uint8Array> | null);
		void drainStream(proc.stderr as ReadableStream<Uint8Array> | null);

		// Wait for the CLI to give up. Allow up to 60s — the
		// guard wants 6 crashes in any 10s window; bun --hot's
		// boot + the CLI's spawn machinery means each cycle is
		// ~1-3s, so 6 cycles can stretch close to 18s before
		// the guard fires. Plus the CLI's cleanup. 60s is
		// generous; the test usually finishes in 15-25s.
		let exitCode: number | string = 'TIMEOUT';
		try {
			exitCode = await Promise.race([
				proc.exited,
				new Promise<number>((_, rej) =>
					setTimeout(
						() => rej(new Error('CLI did not exit in 60s')),
						60_000
					)
				)
			]);
		} catch {
			console.error(
				`[crash-loop-debug] last 40 lines of CLI output:\n${outputLines.slice(-40).join('\n')}`
			);
			throw new Error('CLI did not exit in 60s — see debug above');
		}

		// The CLI exits 1 once it gives up.
		expect(exitCode).toBe(1);

		// `refusing to restart` is the user-facing message.
		const sawRefusal = outputLines.some((l) =>
			/refusing to restart/i.test(l)
		);
		expect(sawRefusal).toBe(true);

		// And we should see the per-cycle "Server exited (code N),
		// restarting..." log at least a few times (proves the
		// supervisor actually ran the respawn loop before
		// hitting the guard, not just hung).
		const restartLogs = outputLines.filter((l) =>
			/Server exited.*restarting/.test(l)
		);
		expect(restartLogs.length).toBeGreaterThanOrEqual(3);
	}, 90_000);
});
