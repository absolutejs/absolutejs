import { $ } from 'bun';
import { env } from 'bun';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DbScripts, InteractiveHandler } from '../../../types/cli';
import { DEFAULT_PORT } from '../../constants';
import { formatTimestamp } from '../../utils/logger';
import { createInteractiveHandler } from '../interactive';
import {
	COMPOSE_PATH,
	isWSLEnvironment,
	killStaleProcesses,
	printHelp,
	printHint,
	readDbScripts,
	startDatabase,
	stopDatabase
} from '../utils';

const cliTag = (color: string, message: string) =>
	`\x1b[2m${formatTimestamp()}\x1b[0m ${color}[cli]\x1b[0m ${color}${message}\x1b[0m`;

export const dev = async (serverEntry: string): Promise<void> => {
	const port = Number(env.PORT) || DEFAULT_PORT;
	killStaleProcesses(port);

	const usesDocker = existsSync(resolve(COMPOSE_PATH));
	const scripts: DbScripts | null = usesDocker ? await readDbScripts() : null;

	if (scripts) await startDatabase(scripts);

	let paused = false;
	let cleaning = false;
	let interactive: InteractiveHandler | null = null;

	let serverReady = false;

	const spawnServer = () => {
		const proc = Bun.spawn(
			['bun', '--hot', '--no-clear-screen', serverEntry],
			{
				cwd: process.cwd(),
				env: {
					...process.env,
					FORCE_COLOR: '1',
					NODE_ENV: 'development'
				},
				stdin: 'ignore',
				stdout: 'pipe',
				stderr: 'pipe'
			}
		);
		const forward = (
			stream: ReadableStream<Uint8Array>,
			dest: NodeJS.WriteStream
		) => {
			const reader = stream.getReader();
			const pump = (): void => {
				reader
					.read()
					.then(({ done, value }) => {
						if (done) return;
						if (serverReady) interactive?.clearPrompt();
						dest.write(value);
						if (!serverReady) {
							const chunk = Buffer.from(value).toString();
							if (chunk.includes('Local:')) {
								serverReady = true;
								interactive?.showPrompt();
							}
						} else {
							interactive?.showPrompt();
						}
						pump();
					})
					.catch(() => {});
			};
			pump();
		};
		forward(proc.stdout, process.stdout);
		forward(proc.stderr, process.stderr);

		return proc;
	};

	let serverProcess = spawnServer();

	const cleanup = async (exitCode = 0): Promise<void> => {
		if (cleaning) return;
		cleaning = true;
		if (interactive) interactive.dispose();
		if (paused) sendSignal('SIGCONT');
		try {
			serverProcess.kill();
		} catch {
			/* process already exited */
		}
		await serverProcess.exited;
		if (scripts) await stopDatabase(scripts);
		process.exit(exitCode);
	};

	const restartServer = async (): Promise<void> => {
		serverReady = false;
		console.log(cliTag('\x1b[36m', 'Restarting server...'));
		const old = serverProcess;
		if (paused) {
			sendSignal('SIGCONT');
			paused = false;
		}
		try {
			old.kill();
		} catch {
			/* already exited */
		}
		serverProcess = spawnServer();
		await old.exited;
		console.log(cliTag('\x1b[32m', 'Server restarted.'));
	};

	const sendSignal = (signal: 'SIGSTOP' | 'SIGCONT'): void => {
		try {
			process.kill(-serverProcess.pid, signal);
		} catch {
			try {
				process.kill(serverProcess.pid, signal);
			} catch {
				/* already exited */
			}
		}
	};

	const togglePause = (): void => {
		if (paused) {
			sendSignal('SIGCONT');
			paused = false;
			console.log(cliTag('\x1b[32m', 'Server resumed.'));
		} else {
			sendSignal('SIGSTOP');
			paused = true;
			console.log(
				`${cliTag('\x1b[33m', 'Server paused.')} \x1b[90m[paused]\x1b[0m`
			);
		}
	};

	const runShellCommand = async (command: string): Promise<void> => {
		await $`${{ raw: command }}`
			.env({ ...process.env, FORCE_COLOR: '1' })
			.nothrow();
	};

	const openInBrowser = async (): Promise<void> => {
		const url = `http://localhost:${port}`;
		const { platform } = process;
		const isWSL = platform === 'linux' && isWSLEnvironment();
		const cmd = isWSL
			? 'cmd.exe'
			: platform === 'darwin'
				? 'open'
				: platform === 'win32'
					? 'start'
					: 'xdg-open';
		const args = isWSL ? ['/c', 'start', url] : [url];
		try {
			Bun.spawn([cmd, ...args], {
				stdout: 'ignore',
				stderr: 'ignore'
			});
			console.log(cliTag('\x1b[36m', `Opening ${url}`));
		} catch {
			console.log(
				cliTag('\x1b[33m', `Could not open browser. Visit ${url}`)
			);
		}
	};

	interactive = createInteractiveHandler({
		clear: () => {
			process.stdout.write('\x1Bc');
		},
		help: () => {
			printHelp();
		},
		open: () => openInBrowser(),
		pause: () => {
			togglePause();
		},
		quit: () => {
			cleanup(0);
		},
		restart: () => restartServer(),
		shell: runShellCommand
	});

	process.on('SIGINT', () => cleanup(0));
	process.on('SIGTERM', () => cleanup(0));

	printHint();

	const monitorServer = async (): Promise<void> => {
		while (!cleaning) {
			const current = serverProcess;
			const exitCode = await current.exited;
			if (cleaning || serverProcess !== current) continue;
			if (exitCode === 130 || exitCode === 143) {
				await cleanup(0);

				return;
			}
			console.error(
				cliTag(
					'\x1b[31m',
					`Server exited (code ${exitCode}), restarting...`
				)
			);
			serverProcess = spawnServer();
		}
	};

	await monitorServer();
};
