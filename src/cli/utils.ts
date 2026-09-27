import { $ } from 'bun';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createServer } from 'node:net';
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
export const findFreePort = () =>
	new Promise<number>((_resolve, reject) => {
		const server = createServer();
		server.unref();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			if (!address || typeof address === 'string') {
				server.close();
				reject(new Error('Failed to allocate a free port'));

				return;
			}

			server.close((error) => {
				if (error) {
					reject(error);

					return;
				}
				_resolve(address.port);
			});
		});
	});

const tryRead = <T>(read: () => T) => {
	try {
		return { ok: true as const, value: read() };
	} catch {
		return { ok: false as const };
	}
};

/** The first reader that succeeds; later readers run only when needed. */
const firstReadable = <T>(fallback: T, ...readers: (() => T)[]) => {
	for (const read of readers) {
		const result = tryRead(read);
		if (result.ok) return result.value;
	}

	return fallback;
};

const processCommand = (pid: number) =>
	firstReadable(
		'',
		() =>
			readFileSync(`/proc/${pid}/cmdline`, 'utf-8')
				.split('\0')
				.join(' ')
				.trim(),
		() =>
			execSync(`ps -o command= -p ${pid}`, {
				encoding: 'utf-8'
			}).trim()
	);

const listedDirectory = (pid: number) => {
	const listed = execSync(`lsof -a -p ${pid} -d cwd -Fn 2>/dev/null`, {
		encoding: 'utf-8'
	});
	const line = listed.split('\n').find((entry) => entry.startsWith('n'));

	return line ? line.slice(1) : null;
};

const processDirectory = (pid: number) =>
	firstReadable<string | null>(
		null,
		() => realpathSync(`/proc/${pid}/cwd`),
		() => listedDirectory(pid)
	);

const ABSOLUTE_PROCESS =
	/@absolutejs[\\/+]absolute|serverBootstrap|[\\/]\.absolutejs[\\/]|\babsolute (?:dev|start|compile|preview)\b/;

/**
 * Whether a process holding the port is a leftover of this project's own
 * AbsoluteJS server, and so safe to replace. Anything else on the port -- an
 * unrelated service, or another project's server -- is someone else's and is
 * left running.
 */
export const isOwnStaleProcess = (
	command: string,
	directory: string | null,
	projectDirectory: string
) =>
	ABSOLUTE_PROCESS.test(command) &&
	(directory === projectDirectory || command.includes(projectDirectory));

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

	const report = (message: string) => {
		if (logMessage) {
			logMessage(message);

			return;
		}
		console.log(
			`\x1b[2m${formatTimestamp()}\x1b[0m \x1b[33m[cli]\x1b[0m \x1b[33m${message}\x1b[0m`
		);
	};
	const pids = output
		.split('\n')
		.map(Number)
		.filter((pid) => pid !== process.pid && pid > 0);
	if (pids.length === 0) {
		return;
	}

	const projectDirectory = realpathSync(process.cwd());
	const holders = pids.map((pid) => ({
		command: processCommand(pid),
		directory: processDirectory(pid),
		pid
	}));
	const own = holders.filter((holder) =>
		isOwnStaleProcess(holder.command, holder.directory, projectDirectory)
	);
	const foreign = holders.filter((holder) => !own.includes(holder));
	own.forEach((holder) => safeKill(holder.pid));
	if (own.length > 0)
		report(
			`Killed ${own.length} stale ${own.length === 1 ? 'process' : 'processes'} on port ${port}.`
		);
	for (const holder of foreign)
		report(
			`Port ${port} is in use by another process (pid ${holder.pid}: ${holder.command.slice(0, 120) || 'unknown'}). It was left running; stop it or choose another port.`
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

export const printHelp = (subject = 'server', mobile = false) => {
	const title = subject === 'workspace' ? 'workspace' : subject;
	console.log('');
	console.log('\x1b[1mShortcuts:\x1b[0m');
	console.log(`  \x1b[36mr\x1b[0m / restart  — Restart ${title}`);
	console.log(`  \x1b[36mp\x1b[0m / pause    — Pause/resume ${title}`);
	console.log('  \x1b[36mo\x1b[0m / open     — Open in browser');
	console.log('  \x1b[36mc\x1b[0m / clear    — Clear terminal');
	console.log('  \x1b[36mm\x1b[0m / heap     — Write a heap snapshot');
	if (mobile) {
		console.log(
			'  \x1b[36md\x1b[0m / device   — Show mobile target status'
		);
		console.log('      relaunch — Relaunch the mobile app');
	}
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
