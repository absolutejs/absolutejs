import { afterEach, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { getAvailablePort } from '../../../helpers/ports';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');
const serverEntry = resolve(PROJECT_ROOT, 'example/server.ts');
const configPath = resolve(PROJECT_ROOT, 'example/absolute.config.ts');
const cliEntry = resolve(PROJECT_ROOT, 'src/cli/index.ts');

let proc: ReturnType<typeof Bun.spawn> | undefined;
let childPid: number | undefined;

const pidAlive = (pid: number) => {
	try {
		process.kill(pid, 0);

		return true;
	} catch {
		return false;
	}
};

afterEach(async () => {
	if (proc) {
		try {
			proc.kill('SIGKILL');
		} catch {
			/* already dead */
		}
		await proc.exited.catch(() => undefined);
		proc = undefined;
	}
	// Belt-and-braces: never leave the Bun dev child running on CI even if
	// the assertion under test failed.
	if (childPid !== undefined && pidAlive(childPid)) {
		try {
			process.kill(childPid, 'SIGKILL');
		} catch {
			/* already dead */
		}
	}
	childPid = undefined;
});

const findChildPid = async (parentPid: number) => {
	const result = Bun.spawnSync(['pgrep', '-P', String(parentPid)]);
	const out = result.stdout.toString().trim();
	if (!out) return undefined;
	const [first] = out
		.split('\n')
		.map((line) => Number.parseInt(line, 10))
		.filter((pid) => Number.isFinite(pid));

	return first;
};

/* SIGKILL on the `absolute dev` CLI runs NO handlers — none of the CLI's
 * SIGINT/SIGTERM/exit cleanup, and not its own ppid watcher. Before the
 * dev-child preload gained a parent-death watchdog, the Bun child
 * survived as an orphan: reparented to init, still bound to the dev port,
 * serving the stale in-memory build forever (edits appear to "not take" no
 * matter how many times the CLI is "restarted"). The preload's watchdog
 * polls the child's own ppid every second and exits when the CLI is gone —
 * this test SIGKILLs the CLI and asserts the child dies on its own. */
describe('SIGKILLed dev CLI does not orphan the Bun child', () => {
	test(
		'kill -9 the CLI → the dev child exits itself within the watchdog window',
		async () => {
			const port = await getAvailablePort();
			const spawnedProc = Bun.spawn(
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
			proc = spawnedProc;

			// Wait until the dev server is actually up ("Local:" banner) so the
			// Bun child exists and is serving.
			const waitUntilReady = async () => {
				const reader = (
					spawnedProc.stdout as ReadableStream<Uint8Array>
				).getReader();
				const decoder = new TextDecoder();
				let buffer = '';
				while (!buffer.includes('Local:')) {
					const { done, value } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });
				}
				reader.releaseLock();
			};
			const ready = waitUntilReady();
			await Promise.race([
				ready,
				new Promise((_resolve, reject) =>
					setTimeout(
						() => reject(new Error('dev server not ready in 90s')),
						90_000
					)
				)
			]);

			childPid = await findChildPid(spawnedProc.pid);
			expect(childPid).toBeDefined();
			if (childPid === undefined) {
				throw new Error('Could not find the dev server child process');
			}
			expect(pidAlive(childPid)).toBe(true);

			// The scenario under test: the CLI dies with NO chance to clean up.
			spawnedProc.kill('SIGKILL');
			await spawnedProc.exited;

			// The child's ppid watchdog polls at 1s; give it a few cycles.
			const deadline = Date.now() + 8000;
			while (pidAlive(childPid) && Date.now() < deadline) {
				await Bun.sleep(250);
			}

			expect(pidAlive(childPid)).toBe(false);
		},
		{ timeout: 120_000 }
	);
});
