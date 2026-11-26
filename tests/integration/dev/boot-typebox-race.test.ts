import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { getAvailablePort } from '../../helpers/ports';

/* The dev bootstrap imports the framework runtime in parallel with the
 * app's server entry. Elysia 2 `require()`s TypeBox synchronously on the
 * first `t.*` call, and Bun rejects a `require()` of a module an `import`
 * is still loading — so an app whose imports build schemas at module
 * scope (the example's auth plugin does) died at startup when the two
 * overlapped. Before the fix that was 5 of 12 boots on this app; ten
 * clean boots in a row had odds of about 1 in 200.
 *
 * A race cannot be pinned by one boot, so this boots repeatedly. Each
 * boot is about a second. */

const PROJECT_ROOT = resolve(import.meta.dir, '../../..');
const BOOTS = 10;
const BOOT_TIMEOUT_MS = 45_000;
const POLL_MS = 100;
const TEST_TIMEOUT_MS = 180_000;

type OutputSink = { text: string };
type BootOutcome = { output: string; state: 'crashed' | 'ready' | 'timeout' };

const collect = async (
	stream: ReadableStream<Uint8Array>,
	sink: OutputSink
) => {
	const decoder = new TextDecoder();
	for await (const chunk of stream) sink.text += decoder.decode(chunk);
};

const isReady = async (port: number) => {
	try {
		const response = await fetch(`http://localhost:${port}/hmr-status`);
		const status: unknown = await response.json();

		return (
			typeof status === 'object' &&
			status !== null &&
			'entryWatcherReady' in status &&
			status.entryWatcherReady === true
		);
	} catch {
		return false;
	}
};

const waitForOutcome = async (
	proc: Bun.Subprocess,
	port: number,
	deadline: number
): Promise<BootOutcome['state']> => {
	if (proc.exitCode !== null) return 'crashed';
	if (await isReady(port)) return 'ready';
	if (performance.now() > deadline) return 'timeout';
	await Bun.sleep(POLL_MS);

	return waitForOutcome(proc, port, deadline);
};

const bootOnce = async (): Promise<BootOutcome> => {
	const port = await getAvailablePort();
	const proc = Bun.spawn(
		[
			process.execPath,
			'--no-clear-screen',
			resolve(PROJECT_ROOT, 'src/dev/serverBootstrap.ts')
		],
		{
			cwd: PROJECT_ROOT,
			env: {
				...process.env,
				ABSOLUTE_CONFIG: resolve(
					PROJECT_ROOT,
					'example/absolute.config.ts'
				),
				ABSOLUTE_SERVER_ENTRY: resolve(
					PROJECT_ROOT,
					'example/server.ts'
				),
				FORCE_COLOR: '0',
				NODE_ENV: 'development',
				PORT: String(port),
				TELEMETRY_OFF: '1'
			},
			stderr: 'pipe',
			stdout: 'pipe'
		}
	);
	const sink: OutputSink = { text: '' };
	void collect(proc.stdout, sink);
	void collect(proc.stderr, sink);

	const state = await waitForOutcome(
		proc,
		port,
		performance.now() + BOOT_TIMEOUT_MS
	);
	proc.kill();
	await proc.exited;

	return { output: sink.text, state };
};

const bootRepeatedly = async (
	remaining: number,
	outcomes: BootOutcome[] = []
): Promise<BootOutcome[]> => {
	if (remaining === 0) return outcomes;
	const outcome = await bootOnce();

	return bootRepeatedly(remaining - 1, [...outcomes, outcome]);
};

describe('dev server startup with schemas built at module scope', () => {
	test(
		`boots ${BOOTS} times in a row without the TypeBox load race`,
		async () => {
			const outcomes = await bootRepeatedly(BOOTS);
			const failed = outcomes.filter(
				(outcome) => outcome.state !== 'ready'
			);

			expect(failed.map((outcome) => outcome.output.slice(-800))).toEqual(
				[]
			);
			expect(
				outcomes.some((outcome) =>
					outcome.output.includes('require() async module')
				)
			).toBe(false);
		},
		TEST_TIMEOUT_MS
	);
});
