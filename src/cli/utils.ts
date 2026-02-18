import { $ } from 'bun';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DbScripts } from '../../types/cli';

export const isWSLEnvironment = (): boolean => {
	try {
		const release = readFileSync('/proc/version', 'utf-8');

		return /microsoft|wsl/i.test(release);
	} catch {
		return false;
	}
};

export const COMPOSE_PATH = 'db/docker-compose.db.yml';
export const DEFAULT_SERVER_ENTRY = 'src/backend/server.ts';

export const readDbScripts = async (): Promise<DbScripts | null> => {
	const pkgPath = resolve('package.json');
	if (!existsSync(pkgPath)) return null;

	const pkg = await Bun.file(pkgPath).json();
	const upCommand: string | undefined = pkg.scripts?.['db:up'];
	const downCommand: string | undefined = pkg.scripts?.['db:down'];

	if (!upCommand || !downCommand) return null;

	return { upCommand, downCommand };
};

export const timed = async (
	label: string,
	fn: () => Promise<void>
): Promise<void> => {
	process.stdout.write(label);
	const start = performance.now();
	await fn();
	const duration = ((performance.now() - start) / 1000).toFixed(2);
	process.stdout.write(` \x1b[90m${duration}s\x1b[0m\n`);
};

export const startDatabase = async (scripts: DbScripts): Promise<void> => {
	await timed('Starting database container...', async () => {
		const { exitCode } = await $`${{ raw: scripts.upCommand }}`
			.quiet()
			.nothrow();
		if (exitCode !== 0) process.exit(exitCode);
	});
};

export const stopDatabase = async (scripts: DbScripts): Promise<void> => {
	console.log('\nStopping database container...');
	await $`${{ raw: scripts.downCommand }}`.quiet().nothrow();
};

export const printHelp = (): void => {
	console.log('');
	console.log('\x1b[1mShortcuts:\x1b[0m');
	console.log('  \x1b[36mr\x1b[0m / restart  — Restart server');
	console.log('  \x1b[36mp\x1b[0m / pause    — Pause/resume server');
	console.log('  \x1b[36mo\x1b[0m / open     — Open in browser');
	console.log('  \x1b[36mc\x1b[0m / clear    — Clear terminal');
	console.log('  \x1b[36mq\x1b[0m / quit     — Graceful shutdown');
	console.log('  \x1b[36mh\x1b[0m / help     — Show this help');
	console.log('  \x1b[36m$\x1b[0m            — Run a shell command');
	console.log(
		'  \x1b[36m↑\x1b[0m / \x1b[36m↓\x1b[0m        — Command history'
	);
	console.log('');
};

export const printHint = (): void => {
	console.log('\x1b[90mpress h + enter to show shortcuts\x1b[0m');
};

export const killStaleProcesses = (port: number): void => {
	try {
		const output = execSync(
			`lsof -ti tcp:${port} -sTCP:LISTEN 2>/dev/null`,
			{ encoding: 'utf-8' }
		).trim();
		if (!output) return;

		const pids = output
			.split('\n')
			.map(Number)
			.filter((pid) => pid !== process.pid && pid > 0);
		if (pids.length === 0) return;

		for (const pid of pids) {
			try {
				process.kill(pid, 'SIGTERM');
			} catch {
				/* already exited */
			}
		}
		console.log(
			`\x1b[33m[cli] Killed ${pids.length} stale ${pids.length === 1 ? 'process' : 'processes'} on port ${port}.\x1b[0m`
		);
	} catch {
		/* lsof not found or no processes — safe to ignore */
	}
};
