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

export const startProdServer = async (port?: number) => {
	const resolvedPort = port ?? (await getAvailablePort());
	const serverEntry = resolve(PROJECT_ROOT, 'example/server.ts');
	const configPath = resolve(PROJECT_ROOT, 'example/absolute.config.ts');
	// outdir must be inside the project root (validateSafePath rejects external paths)
	const testBuildDir = resolve(PROJECT_ROOT, '.test-builds');
	await mkdir(testBuildDir, { recursive: true });
	const outdir = await mkdtemp(resolve(testBuildDir, 'prod-'));

	// Run the start command which builds + bundles + runs
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
	} catch (err) {
		buildProc.kill();
		await rm(outdir, { force: true, recursive: true }).catch(() => {});
		throw new Error(
			`Prod server failed to start on port ${resolvedPort}: ${err}`,
			{ cause: err }
		);
	}

	const kill = async () => {
		try {
			buildProc.kill();
		} catch {
			// already exited
		}
		await buildProc.exited;
		await rm(outdir, { force: true, recursive: true }).catch(() => {});
	};

	return {
		baseUrl,
		kill,
		outdir,
		port: resolvedPort,
		proc: buildProc
	} satisfies ProdServer;
};
