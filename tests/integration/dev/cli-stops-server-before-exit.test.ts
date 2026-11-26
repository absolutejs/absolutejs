import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { getAvailablePort } from '../../helpers/ports';

/* `absolute dev`, stopped by a signal rather than its `q` key — which is
 * how a test runner, a supervisor or a closed terminal stops it.
 *
 * The CLI's shutdown stops the dev server and waits for it, with a
 * SIGKILL if it will not go. None of that ran: the build directory lock
 * registered a signal handler that exits, ahead of the CLI's own.
 * Measured: the CLI gone 2ms after SIGTERM with code 143, its server
 * still alive and the lock on the build directory already released. */

const PROJECT_ROOT = resolve(import.meta.dir, '../../..');
const STARTUP_TIMEOUT_MS = 60_000;
const POLL_MS = 150;
const TEST_TIMEOUT_MS = 120_000;

const childrenOf = async (pid: number): Promise<number[]> => {
	const pgrep = Bun.spawn(['pgrep', '-P', String(pid)], {
		stderr: 'ignore',
		stdout: 'pipe'
	});
	const [output] = await Promise.all([
		new Response(pgrep.stdout).text(),
		pgrep.exited
	]);
	const children = output
		.split('\n')
		.map(Number)
		.filter((child) => Number.isInteger(child) && child > 0);
	const deeper = await Promise.all(children.map(childrenOf));

	return [...children, ...deeper.flat()];
};

const isRunning = (pid: number) => {
	try {
		process.kill(pid, 0);

		return true;
	} catch {
		return false;
	}
};

const waitUntilServing = async (
	proc: Bun.Subprocess,
	port: number,
	deadline: number
): Promise<void> => {
	if (proc.exitCode !== null)
		throw new Error(`absolute dev exited with ${proc.exitCode}`);
	const response = await fetch(`http://localhost:${port}/hmr-status`).catch(
		() => null
	);
	if (response?.ok) return;
	if (performance.now() > deadline)
		throw new Error(`No dev server on port ${port}.`);
	await Bun.sleep(POLL_MS);
	await waitUntilServing(proc, port, deadline);
};

describe('absolute dev, stopped by SIGTERM', () => {
	test(
		'has stopped its server by the time it exits, and exits 0',
		async () => {
			const port = await getAvailablePort();
			const proc = Bun.spawn(
				[
					process.execPath,
					'run',
					resolve(PROJECT_ROOT, 'src/cli/index.ts'),
					'dev',
					resolve(PROJECT_ROOT, 'example/server.ts'),
					'--config',
					resolve(PROJECT_ROOT, 'example/absolute.config.ts'),
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
					stderr: 'ignore',
					stdin: 'ignore',
					stdout: 'ignore'
				}
			);
			let descendants: number[] = [];

			try {
				await waitUntilServing(
					proc,
					port,
					performance.now() + STARTUP_TIMEOUT_MS
				);
				descendants = await childrenOf(proc.pid);
				expect(descendants.length).toBeGreaterThan(0);

				proc.kill('SIGTERM');
				const exitCode = await proc.exited;
				const stillRunning = descendants.filter(isRunning);

				expect(stillRunning).toEqual([]);
				expect(exitCode).toBe(0);
			} finally {
				proc.kill('SIGKILL');
				await proc.exited;
				descendants.filter(isRunning).forEach((pid) => {
					try {
						process.kill(pid, 'SIGKILL');
					} catch {
						// already gone
					}
				});
			}
		},
		TEST_TIMEOUT_MS
	);
});
