import { resolve } from 'node:path';
import { getAvailablePort } from './ports';
import { waitForServer } from './http';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..');

export type DevServer = {
	port: number;
	baseUrl: string;
	proc: ReturnType<typeof Bun.spawn>;
	kill: () => Promise<void>;
};

type DevServerOptions = {
	port?: number;
	serverEntry?: string;
	configPath?: string;
};

export const startDevServer = async (options?: DevServerOptions | number) => {
	// Backwards compat: accept bare port number
	const opts =
		typeof options === 'number' ? { port: options } : (options ?? {});
	const resolvedPort = opts.port ?? (await getAvailablePort());
	const serverEntry =
		opts.serverEntry ?? resolve(PROJECT_ROOT, 'example/server.ts');
	const configPath =
		opts.configPath ?? resolve(PROJECT_ROOT, 'example/absolute.config.ts');

	const proc = Bun.spawn(['bun', '--hot', '--no-clear-screen', serverEntry], {
		cwd: PROJECT_ROOT,
		env: {
			...process.env,
			ABSOLUTE_CONFIG: configPath,
			FORCE_COLOR: '0',
			NODE_ENV: 'development',
			PORT: String(resolvedPort),
			TELEMETRY_OFF: '1'
		},
		stderr: 'pipe',
		stdout: 'pipe'
	});

	const baseUrl = `http://localhost:${resolvedPort}`;

	try {
		await waitForServer(`${baseUrl}/hmr-status`);
	} catch (err) {
		proc.kill();
		throw new Error(
			`Dev server failed to start on port ${resolvedPort}: ${err}`,
			{ cause: err }
		);
	}

	const kill = async () => {
		try {
			proc.kill();
		} catch {
			// already exited
		}
		await proc.exited;
	};

	return { baseUrl, kill, port: resolvedPort, proc } satisfies DevServer;
};
