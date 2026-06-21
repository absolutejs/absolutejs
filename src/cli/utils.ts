import { $ } from 'bun';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DbScripts } from '../../types/cli';
import { MILLISECONDS_IN_A_SECOND } from '../constants';
import { formatTimestamp } from '../utils/startupBanner';

export const COMPOSE_PATH = 'db/docker-compose.db.yml';
export const DEFAULT_SERVER_ENTRY = 'src/backend/server.ts';
export const isWSLEnvironment = () => {
	try {
		const release = readFileSync('/proc/version', 'utf-8');

		return /microsoft|wsl/i.test(release);
	} catch {
		return false;
	}
};
const safeKill = (pid: number) => {
	try {
		process.kill(pid, 'SIGTERM');
	} catch {
		/* already exited */
	}
};

// Ask the OS for an unused TCP port (bind :0, read the assigned port, release it).
// Used to pick a collision-proof port for the compile pre-render server: the old
// `DEFAULT_PORT + 1` is frequently occupied on CI runners, and the `lsof`-based
// stale-process cleanup is a no-op on minimal images where `lsof` isn't installed —
// together those produced an EADDRINUSE that failed every runner compile.
export const findFreePort = (): number => {
	const server = Bun.serve({ fetch: () => new Response(), port: 0 });
	const { port } = server;
	server.stop(true);
	if (port === undefined) {
		throw new Error('Failed to allocate a free port');
	}

	return port;
};

export const killStaleProcesses = (
	port: number,
	logMessage?: (message: string) => void
) => {
	let output: string;
	try {
		output = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN 2>/dev/null`, {
			encoding: 'utf-8'
		}).trim();
	} catch {
		return;
	}
	if (!output) {
		return;
	}

	const pids = output
		.split('\n')
		.map(Number)
		.filter((pid) => pid !== process.pid && pid > 0);
	if (pids.length === 0) {
		return;
	}

	pids.forEach(safeKill);
	const message = `Killed ${pids.length} stale ${pids.length === 1 ? 'process' : 'processes'} on port ${port}.`;
	if (logMessage) {
		logMessage(message);

		return;
	}
	console.log(
		`\x1b[2m${formatTimestamp()}\x1b[0m \x1b[33m[cli]\x1b[0m \x1b[33m${message}\x1b[0m`
	);
};
export const openUrlInBrowser = (
	url: string,
	onError?: (message: string) => void
) => {
	if (process.env.ABSOLUTE_NO_OPEN) return false;

	const { platform } = process;
	const isWSL = platform === 'linux' && isWSLEnvironment();
	let command: string;
	if (isWSL) {
		command = 'cmd.exe';
	} else if (platform === 'darwin') {
		command = 'open';
	} else if (platform === 'win32') {
		command = 'start';
	} else {
		command = 'xdg-open';
	}
	const commandArgs = isWSL ? ['/c', 'start', url] : [url];
	try {
		Bun.spawn([command, ...commandArgs], {
			stderr: 'ignore',
			stdout: 'ignore'
		});

		return true;
	} catch {
		onError?.(`Could not open browser automatically. Visit ${url}`);

		return false;
	}
};

export const printHelp = (subject = 'server') => {
	const title = subject === 'workspace' ? 'workspace' : subject;
	console.log('');
	console.log('\x1b[1mShortcuts:\x1b[0m');
	console.log(`  \x1b[36mr\x1b[0m / restart  — Restart ${title}`);
	console.log(`  \x1b[36mp\x1b[0m / pause    — Pause/resume ${title}`);
	console.log('  \x1b[36mo\x1b[0m / open     — Open in browser');
	console.log('  \x1b[36mc\x1b[0m / clear    — Clear terminal');
	console.log('  \x1b[36mm\x1b[0m / heap     — Write a heap snapshot');
	console.log('  \x1b[36mq\x1b[0m / quit     — Graceful shutdown');
	console.log('  \x1b[36mh\x1b[0m / help     — Show this help');
	console.log('  \x1b[36m$\x1b[0m            — Run a shell command');
	console.log(
		'  \x1b[36m↑\x1b[0m / \x1b[36m↓\x1b[0m        — Command history'
	);
	console.log('');
};
export const printHint = () => {
	console.log('\x1b[90mpress h + enter to show shortcuts\x1b[0m');
};
export const readDbScripts = async () => {
	const pkgPath = resolve('package.json');
	if (!existsSync(pkgPath)) return null;

	const pkg = await Bun.file(pkgPath).json();
	const upCommand: string | undefined = pkg.scripts?.['db:up'];
	const downCommand: string | undefined = pkg.scripts?.['db:down'];

	if (!upCommand || !downCommand) return null;

	return { downCommand, upCommand };
};
export const startDatabase = async (scripts: DbScripts) => {
	await timed('Starting database container...', async () => {
		const { exitCode } = await $`${{ raw: scripts.upCommand }}`
			.quiet()
			.nothrow();
		if (exitCode !== 0) process.exit(exitCode);
	});
};
export const stopDatabase = async (scripts: DbScripts) => {
	console.log('\nStopping database container...');
	await $`${{ raw: scripts.downCommand }}`.quiet().nothrow();
};
export const timed = async (label: string, task: () => Promise<void>) => {
	process.stdout.write(label);
	const start = performance.now();
	await task();
	const duration = (
		(performance.now() - start) /
		MILLISECONDS_IN_A_SECOND
	).toFixed(2);
	process.stdout.write(` \x1b[90m${duration}s\x1b[0m\n`);
};
