import { $ } from 'bun';
import { env } from 'bun';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DbScripts, InteractiveHandler } from '../../../types/cli';
import {
	DEFAULT_PORT,
	MILLISECONDS_IN_A_SECOND,
	SIGINT_EXIT_CODE,
	SIGTERM_EXIT_CODE
} from '../../constants';
import { formatTimestamp } from '../../utils/startupBanner';
import { createInteractiveHandler } from '../interactive';
import { sendTelemetryEvent } from '../telemetryEvent';
import { loadConfig } from '../../utils/loadConfig';
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

export const dev = async (serverEntry: string, configPath?: string) => {
	const port = Number(env.PORT) || DEFAULT_PORT;
	killStaleProcesses(port);

	const usesDocker = existsSync(resolve(COMPOSE_PATH));
	const scripts: DbScripts | null = usesDocker ? await readDbScripts() : null;

	if (scripts) await startDatabase(scripts);

	let paused = false;
	let cleaning = false;
	let interactive: InteractiveHandler | null = null;

	let serverReady = false;

	const checkServerReady = (value: Uint8Array) => {
		const chunk = Buffer.from(value).toString();
		if (!chunk.includes('Local:')) return;
		serverReady = true;
		interactive?.showPrompt();
	};

	const handleChunk = (value: Uint8Array) => {
		if (!serverReady) {
			checkServerReady(value);

			return;
		}
		interactive?.showPrompt();
	};

	const spawnServer = () => {
		const proc = Bun.spawn(
			['bun', '--hot', '--no-clear-screen', serverEntry],
			{
				cwd: process.cwd(),
				env: {
					...process.env,
					FORCE_COLOR: '1',
					NODE_ENV: 'development',
					...(configPath ? { ABSOLUTE_CONFIG: configPath } : {})
				},
				stderr: 'pipe',
				stdin: 'ignore',
				stdout: 'pipe'
			}
		);
		const forward = (
			stream: ReadableStream<Uint8Array>,
			dest: NodeJS.WriteStream
		) => {
			const reader = stream.getReader();
			const pump = () => {
				reader
					.read()
					.then(({ done, value }) => {
						if (done) return;
						if (serverReady) interactive?.clearPrompt();
						dest.write(value);
						handleChunk(value);
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
	const sessionStart = Date.now();

	let frameworks: string[] = [];
	try {
		const cfg = await loadConfig(configPath);
		frameworks = [
			cfg.reactDirectory && 'react',
			cfg.htmlDirectory && 'html',
			cfg.htmxDirectory && 'htmx',
			cfg.svelteDirectory && 'svelte',
			cfg.vueDirectory && 'vue',
			cfg.angularDirectory && 'angular'
		].filter(Boolean) as string[];
	} catch {
		/* config may not be loadable — frameworks stays empty */
	}

	sendTelemetryEvent('dev:start', { entry: serverEntry, frameworks });

	const cleanup = async (exitCode = 0) => {
		if (cleaning) return;
		cleaning = true;
		sendTelemetryEvent('dev:session-duration', {
			duration: Math.round(
				(Date.now() - sessionStart) / MILLISECONDS_IN_A_SECOND
			),
			entry: serverEntry
		});
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

	const restartServer = async () => {
		serverReady = false;
		console.log(cliTag('\x1b[36m', 'Restarting server...'));
		sendTelemetryEvent('dev:restart', { entry: serverEntry });
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

	const sendSignalToGroup = (signal: 'SIGSTOP' | 'SIGCONT') => {
		try {
			process.kill(-serverProcess.pid, signal);

			return true;
		} catch {
			return false;
		}
	};

	const sendSignal = (signal: 'SIGSTOP' | 'SIGCONT') => {
		if (sendSignalToGroup(signal)) return;
		try {
			process.kill(serverProcess.pid, signal);
		} catch {
			/* already exited */
		}
	};

	const togglePause = () => {
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

	const runShellCommand = async (command: string) => {
		await $`${{ raw: command }}`
			.env({ ...process.env, FORCE_COLOR: '1' })
			.nothrow();
	};

	const openInBrowser = async () => {
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
				stderr: 'ignore',
				stdout: 'ignore'
			});
			console.log(cliTag('\x1b[36m', `Opening ${url}`));
		} catch {
			console.log(
				cliTag('\x1b[33m', `Could not open browser. Visit ${url}`)
			);
		}
	};

	interactive = createInteractiveHandler({
		shell: runShellCommand,
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
		restart: () => restartServer()
	});

	process.on('SIGINT', () => cleanup(0));
	process.on('SIGTERM', () => cleanup(0));

	printHint();

	const handleServerExit = async (exitCode: number) => {
		if (exitCode === SIGINT_EXIT_CODE || exitCode === SIGTERM_EXIT_CODE) {
			await cleanup(0);

			return false;
		}
		console.error(
			cliTag(
				'\x1b[31m',
				`Server exited (code ${exitCode}), restarting...`
			)
		);
		sendTelemetryEvent('dev:server-crash', {
			entry: serverEntry,
			exitCode
		});
		serverProcess = spawnServer();

		return true;
	};

	const monitorServer = async () => {
		while (!cleaning) {
			const current = serverProcess;
			const exitCode = await current.exited;
			if (cleaning || serverProcess !== current) continue;
			const shouldContinue = await handleServerExit(exitCode);
			if (!shouldContinue) return;
		}
	};

	await monitorServer();
};
