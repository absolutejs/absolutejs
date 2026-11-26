import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { getAvailablePort } from '../../helpers/ports';

/* `absolute start` is the process an orchestrator signals, and the one
 * whose exit it takes to mean "stopped". Its server is a child that
 * drains in-flight requests on SIGTERM — but the CLI itself exited at
 * once, with 143, because the build directory lock had registered a
 * signal handler that exits and it ran first. Measured: a request 300ms
 * into 1500ms of work, CLI gone at 304ms. Run as a container's first
 * process, that takes the still-draining server down with it.
 *
 * So what is pinned is the ORDER: the response is complete before the
 * CLI has exited, and the CLI exits 0, which is what its own shutdown
 * path reports. */

const PROJECT_ROOT = resolve(import.meta.dir, '../../..');
const CLI = resolve(PROJECT_ROOT, 'src/cli/index.ts');
const SLOW_MS = 1500;
const SIGNAL_AFTER_MS = 300;
const SECOND_SIGNAL_AFTER_MS = 150;
const SIGTERM_EXIT_CODE = 143;
const STARTUP_TIMEOUT_MS = 60_000;
const POLL_MS = 100;
const TEST_TIMEOUT_MS = 90_000;

let directory = '';

beforeAll(async () => {
	// Inside the repository, so the entry's bare `elysia` resolves to the
	// version the plugins were written for.
	const parent = resolve(PROJECT_ROOT, '.test-builds');
	await mkdir(parent, { recursive: true });
	directory = await mkdtemp(join(parent, 'start-drain-'));
	await writeFile(
		join(directory, 'server.ts'),
		`import { Elysia } from 'elysia';
import { networking } from ${JSON.stringify(resolve(PROJECT_ROOT, 'src/plugins/networking.ts'))};
import { shutdown } from ${JSON.stringify(resolve(PROJECT_ROOT, 'src/plugins/shutdown.ts'))};

new Elysia()
	.get('/', () => 'ok')
	.get('/slow', async () => {
		await Bun.sleep(${SLOW_MS});

		return 'finished';
	})
	.use(shutdown(true))
	.use(networking);
`
	);
	await writeFile(
		join(directory, 'absolute.config.ts'),
		'export default {};\n'
	);
});

afterAll(() => rm(directory, { force: true, recursive: true }));

const waitUntilServing = async (
	proc: Bun.Subprocess,
	port: number,
	deadline: number
): Promise<void> => {
	if (proc.exitCode !== null)
		throw new Error(`absolute start exited with ${proc.exitCode}`);
	const response = await fetch(`http://localhost:${port}/`).catch(() => null);
	if (response?.ok) return;
	if (performance.now() > deadline)
		throw new Error(`No server on port ${port}.`);
	await Bun.sleep(POLL_MS);
	await waitUntilServing(proc, port, deadline);
};

const startCli = (port: number) =>
	Bun.spawn(
		[
			process.execPath,
			'run',
			CLI,
			'start',
			join(directory, 'server.ts'),
			'--outdir',
			join(directory, 'build'),
			'--config',
			join(directory, 'absolute.config.ts')
		],
		{
			cwd: PROJECT_ROOT,
			env: {
				...process.env,
				FORCE_COLOR: '0',
				NODE_ENV: 'production',
				PORT: String(port),
				TELEMETRY_OFF: '1'
			},
			stderr: 'ignore',
			stdout: 'ignore'
		}
	);

describe('absolute start, signalled with a request in flight', () => {
	test(
		'exits only after the request has been answered, with code 0',
		async () => {
			const port = await getAvailablePort();
			const proc = startCli(port);

			try {
				await waitUntilServing(
					proc,
					port,
					performance.now() + STARTUP_TIMEOUT_MS
				);

				const order: string[] = [];
				const answered = fetch(`http://localhost:${port}/slow`).then(
					async (response) => {
						const body = await response.text();
						order.push('answered');

						return { body, status: response.status };
					}
				);
				const exited = proc.exited.then((code) => {
					order.push('exited');

					return code;
				});

				await Bun.sleep(SIGNAL_AFTER_MS);
				proc.kill('SIGTERM');

				expect(await answered).toEqual({
					body: 'finished',
					status: 200
				});
				expect(await exited).toBe(0);
				expect(order).toEqual(['answered', 'exited']);
			} finally {
				proc.kill('SIGKILL');
				await proc.exited;
			}
		},
		TEST_TIMEOUT_MS
	);

	/* Waiting for a drain must not take away the way out of one: an
	 * operator who signals twice means it. */
	test(
		"a second signal exits at once, with the signal's own code",
		async () => {
			const port = await getAvailablePort();
			const proc = startCli(port);

			try {
				await waitUntilServing(
					proc,
					port,
					performance.now() + STARTUP_TIMEOUT_MS
				);
				void fetch(`http://localhost:${port}/slow`).catch(() => null);
				await Bun.sleep(SIGNAL_AFTER_MS);

				const signalledAt = performance.now();
				proc.kill('SIGTERM');
				await Bun.sleep(SECOND_SIGNAL_AFTER_MS);
				proc.kill('SIGTERM');

				expect(await proc.exited).toBe(SIGTERM_EXIT_CODE);
				expect(performance.now() - signalledAt).toBeLessThan(
					SLOW_MS - SIGNAL_AFTER_MS
				);
			} finally {
				proc.kill('SIGKILL');
				await proc.exited;
			}
		},
		TEST_TIMEOUT_MS
	);
});
