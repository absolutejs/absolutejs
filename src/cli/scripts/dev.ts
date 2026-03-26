import { $, env } from 'bun';
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

// Lightweight interactive yes/no prompt with arrow key support.
// ◆ message
//   ● Yes  ○ No    (use ←/→ arrow keys, enter to confirm)
const confirmPrompt = (message: string, defaultYes = true) =>
	new Promise<boolean>((res) => {
		let selected = defaultYes;

		const render = () => {
			const yes = selected
				? '\x1b[36m●\x1b[0m Yes'
				: '\x1b[2m○ Yes\x1b[0m';
			const no = !selected ? '\x1b[36m●\x1b[0m No' : '\x1b[2m○ No\x1b[0m';
			// Move to start, clear line, print question + options
			process.stdout.write(
				`\x1b[2K\x1b[36m◆\x1b[0m ${message}\n\x1b[2K  ${yes}  ${no}\x1b[A\r`
			);
		};

		process.stdout.write('\x1b[?25l'); // hide cursor
		process.stdin.setRawMode(true);
		process.stdin.resume();
		render();

		const onData = (data: Buffer) => {
			const key = data.toString();
			if (key === '\x1b[D' || key === '\x1b[C' || key === '\t') {
				// Left/Right arrow or Tab — toggle
				selected = !selected;
				render();
			} else if (key === '\r' || key === '\n') {
				// Enter — confirm
				process.stdin.setRawMode(false);
				process.stdin.pause();
				process.stdin.removeListener('data', onData);
				const label = selected ? 'Yes' : 'No';
				process.stdout.write(
					`\x1b[2K\x1b[32m◇\x1b[0m ${message}\n\x1b[2K  \x1b[2m${label}\x1b[0m\n\x1b[?25h`
				);
				res(selected);
			} else if (key === '\x03') {
				// Ctrl+C — restore cursor and exit
				process.stdout.write('\x1b[?25h');
				process.stdin.setRawMode(false);
				process.exit(0);
			}
		};

		process.stdin.on('data', onData);
	});

export const dev = async (serverEntry: string, configPath?: string) => {
	const port = Number(env.PORT) || DEFAULT_PORT;
	killStaleProcesses(port);

	// Check if HTTPS is enabled in config
	let httpsEnabled = false;
	try {
		const { loadConfig } = await import('../../utils/loadConfig');
		const config = await loadConfig(configPath);
		httpsEnabled = config?.dev?.https === true;
		if (httpsEnabled) {
			const { hasCert, hasMkcert, ensureDevCert, setupMkcert } =
				await import('../../dev/devCert');
			if (!hasCert()) {
				// First time — no cert exists. Ask about mkcert.
				if (!hasMkcert()) {
					const install = await confirmPrompt(
						'Install mkcert for trusted HTTPS? (no browser warning)'
					);
					if (install) {
						setupMkcert();
					} else {
						ensureDevCert();
					}
				} else {
					// Has mkcert but no cert — generate silently
					ensureDevCert();
				}
			} else {
				// Cert exists — just use it, no prompt, no log
				ensureDevCert();
			}
		}
	} catch {
		// config load failed, skip https
	}

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
		const proc = Bun.spawn(['bun', '--no-clear-screen', serverEntry], {
			cwd: process.cwd(),
			env: {
				...process.env,
				FORCE_COLOR: '1',
				NODE_ENV: 'development',
				...(configPath ? { ABSOLUTE_CONFIG: configPath } : {}),
				...(httpsEnabled ? { ABSOLUTE_HTTPS: 'true' } : {})
			},
			stderr: 'pipe',
			stdin: 'ignore',
			stdout: 'pipe'
		});
		const forward = (
			stream: ReadableStream<Uint8Array>,
			dest: NodeJS.WriteStream
		) => {
			const reader = stream.getReader();
			const pump = () => {
				reader
					.read()
					.then(({ done, value }) => {
						if (done) return undefined;
						if (serverReady) interactive?.clearPrompt();
						dest.write(value);
						handleChunk(value);
						pump();

						return undefined;
					})
					.catch(() => {
						/* noop */
					});
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
	let frameworkDirs: string[] = [];
	try {
		const cfg = await loadConfig(configPath);
		frameworks = [
			cfg.reactDirectory && 'react',
			cfg.htmlDirectory && 'html',
			cfg.htmxDirectory && 'htmx',
			cfg.svelteDirectory && 'svelte',
			cfg.vueDirectory && 'vue',
			cfg.angularDirectory && 'angular'
		].filter((val): val is string => Boolean(val));
		frameworkDirs = [
			cfg.reactDirectory,
			cfg.htmlDirectory,
			cfg.htmxDirectory,
			cfg.svelteDirectory,
			cfg.vueDirectory,
			cfg.angularDirectory
		]
			.filter((val): val is string => Boolean(val))
			.map((dir) => resolve(dir));
	} catch {
		/* config may not be loadable — frameworks stays empty */
	}

	// Watch server files (everything OUTSIDE framework directories).
	// Restart the server only for server code changes — frontend
	// changes are handled by the HMR file watcher inside the server.
	const { watch } = await import('fs');
	const serverDir = resolve(serverEntry, '..');
	let resolvedBuildDir = '';
	try {
		const cfg = await loadConfig(configPath);
		resolvedBuildDir = resolve(cfg.buildDirectory ?? 'build');
	} catch {
		/* use empty string — no build dir to exclude */
	}

	const isFrameworkFile = (filePath: string) =>
		frameworkDirs.some((dir) => resolve(filePath).startsWith(dir));
	const isBuildFile = (filePath: string) =>
		resolvedBuildDir !== '' &&
		resolve(filePath).startsWith(resolvedBuildDir);

	let restartTimeout: NodeJS.Timeout | null = null;
	watch(serverDir, { recursive: true }, (_event, filename) => {
		if (!filename) return;
		const fullPath = resolve(serverDir, filename);
		if (isFrameworkFile(fullPath)) return;
		if (isBuildFile(fullPath)) return;
		if (!filename.endsWith('.ts') && !filename.endsWith('.tsx')) return;
		if (filename.includes('.tmp.') || filename.endsWith('.tmp')) return;

		if (restartTimeout) clearTimeout(restartTimeout);
		restartTimeout = setTimeout(() => {
			console.log(
				`\x1b[2m${formatTimestamp()}\x1b[0m \x1b[36m[cli]\x1b[0m \x1b[36mServer file changed, restarting...\x1b[0m`
			);
			restartServer();
		}, 100);
	});

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
		let cmd: string;
		if (isWSL) {
			cmd = 'cmd.exe';
		} else if (platform === 'darwin') {
			cmd = 'open';
		} else if (platform === 'win32') {
			cmd = 'start';
		} else {
			cmd = 'xdg-open';
		}
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
			// eslint-disable-next-line no-await-in-loop -- must wait for each server process sequentially
			const exitCode = await current.exited;
			if (cleaning || serverProcess !== current) continue;
			// eslint-disable-next-line no-await-in-loop -- cleanup depends on previous iteration
			const shouldContinue = await handleServerExit(exitCode);
			if (!shouldContinue) return;
		}
	};

	await monitorServer();
};
