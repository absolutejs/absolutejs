/* Orchestrate the multi-size benchmark. For each size:
 *   1. Run scripts/grow.ts <count> to (re)generate the fixture.
 *   2. Spawn `absolute dev server.ts` as a child process.
 *   3. Wait for the dev server to print "ready in".
 *   4. Run bench.ts via WebSocket against the live dev.
 *   5. Kill the dev server.
 *
 * Aggregates the per-size results into a single markdown table on
 * stdout. Restores the fixture to size 0 (the committed shape with
 * no filler components) when finished, so a subsequent
 * `bun run dev` launches the small project.
 *
 * Usage: bun run scripts/run.ts */

import {
	promises as fs,
	existsSync,
	readFileSync,
	writeFileSync
} from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolvePath(HERE, '..');

type SizeSpec = { label: string; count: number; port: number };
type RunOptions = { cwd?: string; env?: NodeJS.ProcessEnv };

const SIZES: SizeSpec[] = [
	{ count: 3, label: 'small', port: 4331 },
	{ count: 30, label: 'medium', port: 4332 },
	{ count: 100, label: 'large', port: 4333 }
];

const sleep = (milliseconds: number) =>
	new Promise((resolve) => setTimeout(resolve, milliseconds));

const runOnce = (cmd: string, args: string[], options: RunOptions = {}) =>
	new Promise<void>((resolve, reject) => {
		const child = spawn(cmd, args, {
			cwd: options.cwd ?? PROJECT,
			env: options.env ?? process.env,
			stdio: 'inherit'
		});
		child.on('exit', (code) => {
			if (code === 0) resolve();
			else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`));
		});
		child.on('error', reject);
	});

/* Kill any process listening on the given port. Walks `lsof -ti`
 * and SIGKILLs the matching pids. Used as a sledgehammer to clean
 * up `bun --hot` children that survive `process.kill` of their
 * parent group (Bun's process tree management around `--hot`
 * doesn't cooperate with the parent group's SIGTERM). */
const killPort = async (port: number) => {
	await new Promise<void>((resolve) => {
		const child = spawn(
			'sh',
			['-c', `lsof -ti:${port} | xargs -r kill -9`],
			{
				stdio: 'ignore'
			}
		);
		child.on('exit', () => resolve());
		child.on('error', () => resolve());
	});
	await sleep(300);
};

const waitForDev = async (port: number, logPath: string) => {
	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline) {
		await sleep(500);
		const log = readFileSync(logPath, 'utf8');
		if (/ABSOLUTEJS .* ready in/.test(log)) return;
		if (!/EADDRINUSE|error: /.test(log)) continue;

		await killPort(port);
		throw new Error(`dev failed to start: ${log.slice(-2000)}`);
	}
};

const killProcessGroup = (pid: number) => {
	try {
		process.kill(-pid, 'SIGTERM');
	} catch {
		/* already gone */
	}
};

const terminateDev = async (child: ReturnType<typeof spawn>, port: number) => {
	if (child.pid !== undefined) killProcessGroup(child.pid);
	child.kill('SIGTERM');
	await sleep(700);
	await killPort(port);
};

const startDev = async (port: number, logPath: string) => {
	// Cleanup leftover from a prior run before we even attempt to bind.
	await killPort(port);
	if (existsSync(logPath)) await fs.rm(logPath);
	writeFileSync(logPath, '');

	const child = spawn('bun', ['run', '--', 'absolute', 'dev', 'server.ts'], {
		cwd: PROJECT,
		detached: true,
		env: { ...process.env, ABSOLUTE_PORT: String(port) },
		stdio: ['ignore', 'pipe', 'pipe']
	});

	const tail = (chunk: Buffer) => {
		writeFileSync(logPath, chunk, { flag: 'a' });
	};
	child.stdout?.on('data', tail);
	child.stderr?.on('data', tail);

	await waitForDev(port, logPath);

	return {
		logPath,
		kill: () => terminateDev(child, port)
	};
};

type BenchResult = {
	size: string;
	cold: { e2eMs: number; serverMs: number | null } | null;
	cases: Array<{
		name: string;
		e2e: {
			n: number;
			min: number;
			p50: number;
			mean: number;
			p95: number;
			max: number;
		};
		server: {
			n: number;
			min: number;
			p50: number;
			mean: number;
			p95: number;
			max: number;
		};
	}>;
};

const allResults: BenchResult[] = [];

for (const size of SIZES) {
	console.log(`\n=== ${size.label} (${size.count} filler components) ===\n`);
	await runOnce('bun', ['run', 'scripts/grow.ts', String(size.count)]);

	const logPath = resolvePath(PROJECT, `dev-${size.label}.log`);
	const dev = await startDev(size.port, logPath);
	console.log(`dev ready on :${size.port}`);

	const resultsPath = resolvePath(PROJECT, `bench-${size.label}.json`);
	try {
		await runOnce('bun', ['run', 'bench.ts'], {
			env: {
				...process.env,
				HMR_BENCH_DEV_LOG: logPath,
				HMR_BENCH_RESULTS: resultsPath,
				HMR_BENCH_SIZE: size.label,
				HMR_BENCH_WS_URL: `ws://localhost:${size.port}/hmr`
			}
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(
			`bench for size=${size.label} exited with error: ${message}`
		);
		console.error('continuing with whatever partial results were written');
	} finally {
		await dev.kill();
	}

	if (existsSync(resultsPath)) {
		const parsed: BenchResult = JSON.parse(
			readFileSync(resultsPath, 'utf8')
		);
		allResults.push(parsed);
	}
}

// Reset the fixture to the committed state (no fillers).
await runOnce('bun', ['run', 'scripts/grow.ts', '0']);

console.log('\n\n=== aggregate results ===\n');
const fmt = (value: number | null | undefined) =>
	value === null || value === undefined ? '—' : value.toFixed(1);
console.log(
	'| size | cold e2e | cold server | case | warm e2e p50 | warm e2e p95 | warm server p50 | warm server p95 |'
);
console.log(
	'|------|----------|-------------|------|--------------|--------------|------------------|------------------|'
);
for (const result of allResults) {
	for (const benchmarkCase of result.cases) {
		console.log(
			`| ${result.size} | ${fmt(result.cold?.e2eMs)} | ${fmt(result.cold?.serverMs)} | ${benchmarkCase.name} | ${fmt(benchmarkCase.e2e.p50)} | ${fmt(benchmarkCase.e2e.p95)} | ${fmt(benchmarkCase.server.p50)} | ${fmt(benchmarkCase.server.p95)} |`
		);
	}
}

process.exit(0);
