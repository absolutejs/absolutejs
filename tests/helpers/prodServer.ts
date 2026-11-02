import { resolve } from 'node:path';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { getAvailablePort } from './ports';
import { waitForServer } from './http';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..');

export type ProdServer = {
	port: number;
	baseUrl: string;
	proc: ReturnType<typeof Bun.spawn>;
	outdir: string;
	kill: () => Promise<void>;
};

/* Processes whose command line names this build directory: the server
 * `absolute start` spawned runs `bun run <outdir>/server.js`. */
const processesUsing = async (outdir: string) => {
	const pgrep = Bun.spawn(['pgrep', '-f', outdir], {
		stderr: 'ignore',
		stdout: 'pipe'
	});
	const [output] = await Promise.all([
		new Response(pgrep.stdout).text(),
		pgrep.exited
	]);

	return output
		.split('\n')
		.map(Number)
		.filter(
			(pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid
		);
};

export const startProdServer = async (port?: number) => {
	const serverEntry = resolve(PROJECT_ROOT, 'example/server.ts');
	const configPath = resolve(PROJECT_ROOT, 'example/absolute.config.ts');
	const testBuildDir = resolve(PROJECT_ROOT, '.test-builds');
	await mkdir(testBuildDir, { recursive: true });

	let lastError: unknown;
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const resolvedPort = port ?? (await getAvailablePort());
		const outdir = await mkdtemp(resolve(testBuildDir, 'prod-'));
		const buildProc = Bun.spawn(
			[
				'bun',
				'run',
				resolve(PROJECT_ROOT, 'src/cli/index.ts'),
				'start',
				serverEntry,
				'--outdir',
				outdir,
				'--config',
				configPath
			],
			{
				cwd: PROJECT_ROOT,
				env: {
					...process.env,
					FORCE_COLOR: '0',
					NODE_ENV: 'production',
					PORT: String(resolvedPort),
					TELEMETRY_OFF: '1'
				},
				stderr: 'pipe',
				stdout: 'pipe'
			}
		);

		const baseUrl = `http://localhost:${resolvedPort}`;

		try {
			await waitForServer(baseUrl, 60, 500);

			const kill = async () => {
				try {
					buildProc.kill();
				} catch {
					// already exited
				}
				await buildProc.exited;
				// Stopping `absolute start` stops the server it spawned. A
				// server still running from this build is a leak: it outlives
				// the test and keeps its port (2026-11-02).
				const survivors = await processesUsing(outdir);
				survivors.forEach((pid) => {
					try {
						process.kill(pid, 'SIGKILL');
					} catch {
						// already gone
					}
				});
				await rm(outdir, { force: true, recursive: true }).catch(
					() => {}
				);
				if (survivors.length > 0)
					throw new Error(
						`Stopping the production server left ${survivors.length} process(es) from ${outdir} running: ${survivors.join(', ')}`
					);
			};

			return {
				baseUrl,
				kill,
				outdir,
				port: resolvedPort,
				proc: buildProc
			} satisfies ProdServer;
		} catch (err) {
			lastError = err;
			buildProc.kill();
			await rm(outdir, { force: true, recursive: true }).catch(() => {});
			if (port || attempt === 1) {
				throw new Error(
					`Prod server failed to start on port ${resolvedPort}: ${err}`,
					{ cause: err }
				);
			}
		}
	}

	throw new Error(`Prod server failed to start: ${lastError}`);
};
