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
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(HERE, '..');

type SizeSpec = { label: string; count: number; port: number };

const SIZES: SizeSpec[] = [
	{ count: 3, label: 'small', port: 4331 },
	{ count: 30, label: 'medium', port: 4332 },
	{ count: 100, label: 'large', port: 4333 }
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const runOnce = (
	cmd: string,
	args: string[],
	opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): Promise<void> =>
	new Promise((res, rej) => {
		const child = spawn(cmd, args, {
			cwd: opts.cwd ?? PROJECT,
			env: opts.env ?? process.env,
			stdio: 'inherit'
		});
		child.on('exit', (code) => {
			if (code === 0) res();
			else rej(new Error(`${cmd} ${args.join(' ')} exited ${code}`));
		});
		child.on('error', rej);
	});

type DevHandle = {
	kill: () => Promise<void>;
	logPath: string;
};

/* Kill any process listening on the given port. Walks `lsof -ti`
 * and SIGKILLs the matching pids. Used as a sledgehammer to clean
 * up `bun --hot` children that survive `process.kill` of their
 * parent group (Bun's process tree management around `--hot`
 * doesn't cooperate with the parent group's SIGTERM). */
const killPort = async (port: number): Promise<void> => {
	await new Promise<void>((res) => {
		const child = spawn('sh', ['-c', `lsof -ti:${port} | xargs -r kill -9`], {
			stdio: 'ignore'
		});
		child.on('exit', () => res());
		child.on('error', () => res());
	});
	await sleep(300);
};

const startDev = async (port: number, logPath: string): Promise<DevHandle> => {
	// Cleanup leftover from a prior run before we even attempt to bind.
	await killPort(port);
	if (existsSync(logPath)) await fs.rm(logPath);
	writeFileSync(logPath, '');

	const child = spawn(
		'bun',
		['run', '--', 'absolute', 'dev', 'server.ts'],
		{
			cwd: PROJECT,
			detached: true,
			env: { ...process.env, ABSOLUTE_PORT: String(port) },
			stdio: ['ignore', 'pipe', 'pipe']
		}
	);

	const tail = (chunk: Buffer) => {
		writeFileSync(logPath, chunk, { flag: 'a' });
	};
	child.stdout?.on('data', tail);
	child.stderr?.on('data', tail);

	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline) {
		await sleep(500);
		const log = readFileSync(logPath, 'utf8');
		if (/ABSOLUTEJS .* ready in/.test(log)) break;
		if (/EADDRINUSE|error: /.test(log)) {
			await killPort(port);
			throw new Error(`dev failed to start: ${log.slice(-2000)}`);
		}
	}

	return {
		kill: async () => {
			// Group SIGTERM to the spawn'd parent process.
			if (child.pid !== undefined) {
				try {
					process.kill(-child.pid, 'SIGTERM');
				} catch {
					/* already gone */
				}
			}
			child.kill('SIGTERM');
			await sleep(700);
			// `bun --hot` grandchild might still be bound to the
			// port — SIGKILL by port to guarantee cleanup.
			await killPort(port);
		},
		logPath
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

	const logPath = resolve(PROJECT, `dev-${size.label}.log`);
	const dev = await startDev(size.port, logPath);
	console.log(`dev ready on :${size.port}`);

	const resultsPath = resolve(PROJECT, `bench-${size.label}.json`);
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
	} catch (err) {
		console.error(
			`bench for size=${size.label} exited with error: ${(err as Error).message}`
		);
		console.error('continuing with whatever partial results were written');
	} finally {
		await dev.kill();
	}

	if (existsSync(resultsPath)) {
		const parsed = JSON.parse(readFileSync(resultsPath, 'utf8')) as BenchResult;
		allResults.push(parsed);
	}
}

// Reset the fixture to the committed state (no fillers).
await runOnce('bun', ['run', 'scripts/grow.ts', '0']);

console.log('\n\n=== aggregate results ===\n');
const fmt = (n: number | null | undefined) =>
	n === null || n === undefined ? '—' : n.toFixed(1);
console.log(
	'| size | cold e2e | cold server | case | warm e2e p50 | warm e2e p95 | warm server p50 | warm server p95 |'
);
console.log(
	'|------|----------|-------------|------|--------------|--------------|------------------|------------------|'
);
for (const r of allResults) {
	for (const c of r.cases) {
		console.log(
			`| ${r.size} | ${fmt(r.cold?.e2eMs)} | ${fmt(r.cold?.serverMs)} | ${c.name} | ${fmt(c.e2e.p50)} | ${fmt(c.e2e.p95)} | ${fmt(c.server.p50)} | ${fmt(c.server.p95)} |`
		);
	}
}

process.exit(0);
