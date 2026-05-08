import { $, env } from 'bun';
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
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
import {
	acquireBuildDirectoryLock,
	updateLockMetadata
} from '../../utils/buildDirectoryLock';
import { loadConfig } from '../../utils/loadConfig';
import { resolveDevPort } from '../../utils/resolveDevPort';
import {
	COMPOSE_PATH,
	isWSLEnvironment,
	printHelp,
	printHint,
	readDbScripts,
	startDatabase,
	stopDatabase
} from '../utils';

const cliTag = (color: string, message: string) =>
	`\x1b[2m${formatTimestamp()}\x1b[0m ${color}[cli]\x1b[0m ${color}${message}\x1b[0m`;

const DEFAULT_PORT_RANGE = 10;

// Lightweight interactive yes/no prompt with arrow key support.
// ◆ message
//   ● Yes  ○ No    (use ←/→ arrow keys, enter to confirm)
const confirmPrompt = (message: string, defaultYes = true) => {
	const { promise, resolve: resolvePrompt } =
		Promise.withResolvers<boolean>();
	let selected = defaultYes;

	const render = () => {
		const yes = selected ? '\x1b[36m●\x1b[0m Yes' : '\x1b[2m○ Yes\x1b[0m';
		const noLabel = !selected
			? '\x1b[36m●\x1b[0m No'
			: '\x1b[2m○ No\x1b[0m';
		// Move to start, clear line, print question + options
		process.stdout.write(
			`\x1b[2K\x1b[36m◆\x1b[0m ${message}\n\x1b[2K  ${yes}  ${noLabel}\x1b[A\r`
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
			resolvePrompt(selected);
		} else if (key === '\x03') {
			// Ctrl+C — restore cursor and exit
			process.stdout.write('\x1b[?25h');
			process.stdin.setRawMode(false);
			process.exit(0);
		}
	};

	process.stdin.on('data', onData);

	return promise;
};

const setupCertWithPrompt = async (
	ensureDevCert: () => void,
	setupMkcert: () => void
) => {
	const install = await confirmPrompt(
		'Install mkcert for trusted HTTPS? (no browser warning)'
	);

	if (install) {
		setupMkcert();
	} else {
		ensureDevCert();
	}
};

const setupHttpsCert = async () => {
	const { hasCert, hasMkcert, ensureDevCert, setupMkcert } = await import(
		'../../dev/devCert'
	);

	if (hasCert()) {
		ensureDevCert();

		return;
	}

	if (hasMkcert()) {
		ensureDevCert();

		return;
	}

	await setupCertWithPrompt(ensureDevCert, setupMkcert);
};

type ResolvedDevConfig = {
	port: number;
	portRange: number;
	strictPort: boolean;
	host: string;
	https: boolean;
};

/** Resolve dev-server settings with env-var precedence over config file.
 *  Env always wins so `ABSOLUTE_PORT=4000 bun dev` is unambiguous. */
const resolveDevConfig = (
	configDev:
		| {
				port?: number;
				portRange?: number;
				strictPort?: boolean;
				host?: string;
				https?: boolean;
		  }
		| undefined
): ResolvedDevConfig => ({
	port:
		Number(env.ABSOLUTE_PORT) ||
		Number(env.PORT) ||
		configDev?.port ||
		DEFAULT_PORT,
	portRange:
		Number(env.ABSOLUTE_PORT_RANGE) ||
		configDev?.portRange ||
		DEFAULT_PORT_RANGE,
	strictPort:
		env.ABSOLUTE_STRICT_PORT === 'true' || configDev?.strictPort === true,
	host: env.ABSOLUTE_HOST ?? configDev?.host ?? 'localhost',
	https: env.ABSOLUTE_HTTPS === 'true' || configDev?.https === true
});

export const dev = async (serverEntry: string, configPath?: string) => {
	let httpsEnabled = false;
	let resolvedDev: ResolvedDevConfig;
	let buildDirectory = resolve(process.cwd(), 'build');
	try {
		const config = await loadConfig(configPath);
		resolvedDev = resolveDevConfig(config?.dev);
		httpsEnabled = resolvedDev.https;
		if (config?.buildDirectory) {
			buildDirectory = resolve(process.cwd(), config.buildDirectory);
		}
		if (httpsEnabled) await setupHttpsCert();
	} catch {
		// config load failed, fall back to env-only defaults
		resolvedDev = resolveDevConfig(undefined);
		httpsEnabled = resolvedDev.https;
	}

	// §1.2 — acquire the build-directory lock as early as possible, so an
	// immediate Ctrl-C during boot still releases cleanly via the
	// process.on('exit') / SIGINT handlers registered inside acquireBuildDirectoryLock.
	// Lock metadata starts with port=null and gets filled in once the
	// port is resolved below (resolveDevPort can fail before then, but
	// the lock is already orphan-aware so a stale lock from a previous
	// run is recovered transparently).
	try {
		await acquireBuildDirectoryLock(buildDirectory, {
			port: null,
			wait: false
		});
	} catch (err) {
		console.error(
			cliTag('\x1b[31m', err instanceof Error ? err.message : String(err))
		);
		process.exit(1);
	}

	// §1.3 — Vite-style port resolution. Probe configured port first, then
	// fall through up to portRange-1 neighbors. strictPort=true keeps the
	// configured port and fails fast on conflict.
	const { port, fellBack } = await resolveDevPort(resolvedDev.port, {
		host: resolvedDev.host,
		portRange: resolvedDev.portRange,
		strictPort: resolvedDev.strictPort
	}).catch((err) => {
		console.error(cliTag('\x1b[31m', String(err.message ?? err)));
		process.exit(1);
	});
	if (fellBack) {
		const displayHost =
			resolvedDev.host === '0.0.0.0' ? 'localhost' : resolvedDev.host;
		console.log(
			cliTag(
				'\x1b[33m',
				`Port ${resolvedDev.port} is in use, trying another one... → http://${displayHost}:${port}/`
			)
		);
	}

	// §1.2 + §1.3 — record the resolved port in the lock file so a second
	// `bun dev` invocation that finds the lock held can include the port
	// in its "PID X holds port Y" error message.
	updateLockMetadata(buildDirectory, { port });

	const usesDocker = existsSync(resolve(COMPOSE_PATH));
	const scripts: DbScripts | null = usesDocker ? await readDbScripts() : null;

	if (scripts) await startDatabase(scripts);

	let paused = false;
	let cleaning = false;
	let interactive: InteractiveHandler | null = null;

	let serverReady = false;

	const checkServerReady = (value: Buffer) => {
		const chunk = value.toString();
		if (!chunk.includes('Local:')) return;
		serverReady = true;
		interactive?.showPrompt();
	};

	const handleChunk = (value: Buffer) => {
		if (!serverReady) {
			checkServerReady(value);

			return;
		}
		interactive?.showPrompt();
	};

	/** §1.3 — Spawn the bun --hot child in its own process group so that
	 *  on parent exit we can `kill(-childPgid, SIGTERM)` and cascade to
	 *  the entire subtree. Bun.spawn doesn't expose detached/process-group
	 *  knobs, so this one spawn uses node:child_process for portability
	 *  across Linux/macOS/Windows. */
	const spawnServer = (): ChildProcess => {
		const proc = nodeSpawn(
			'bun',
			['--hot', '--no-clear-screen', serverEntry],
			{
				cwd: process.cwd(),
				detached: true, // new process group → kill cascades
				env: {
					...process.env,
					FORCE_COLOR: '1',
					NODE_ENV: 'development',
					ABSOLUTE_PORT: String(port),
					PORT: String(port),
					...(configPath ? { ABSOLUTE_CONFIG: configPath } : {}),
					...(httpsEnabled ? { ABSOLUTE_HTTPS: 'true' } : {})
				},
				stdio: ['ignore', 'pipe', 'pipe']
			}
		);

		const forward = (
			source: NodeJS.ReadableStream | null,
			dest: NodeJS.WriteStream
		) => {
			if (!source) return;
			source.on('data', (chunk: Buffer) => {
				if (serverReady) interactive?.clearPrompt();
				dest.write(chunk);
				handleChunk(chunk);
			});
		};
		forward(proc.stdout, process.stdout);
		forward(proc.stderr, process.stderr);

		return proc;
	};

	let serverProcess: ChildProcess = spawnServer();
	const sessionStart = Date.now();

	// Watch the server entry file for edits and restart the bun child
	// process when it changes. `bun --hot` re-evaluates the module but
	// Elysia's `.listen()` doesn't have a hot-swap story — the OLD
	// listener stays bound to the port and new routes/handlers added
	// in the edit silently never take effect. A full child-process
	// restart is the only reliable way for Elysia (and most other
	// HTTP frameworks). Frontend file edits go through the in-process
	// HMR pipeline so this restart only fires on backend / route /
	// handler edits. Wired here at the CLI rather than inside the
	// bun child because we can't ask the child to restart itself
	// gracefully without dropping the parent's process-group + signal
	// plumbing.
	let serverRestartPending = false;
	const scheduleServerRestart = (filePath: string) => {
		if (serverRestartPending) return;
		serverRestartPending = true;
		const relPath = filePath.startsWith(process.cwd())
			? filePath.slice(process.cwd().length + 1)
			: filePath;
		console.log(
			cliTag('\x1b[36m', `Server file changed: ${relPath} — restarting...`)
		);
		setTimeout(() => {
			serverRestartPending = false;
			restartServer().catch((err) => {
				console.error(cliTag('\x1b[31m', `Restart failed: ${err}`));
			});
		}, 80);
	};
	try {
		const { watch, existsSync } = await import('node:fs');
		const { dirname, basename } = await import('node:path');
		const absServerEntry = resolve(serverEntry);
		const serverEntryDir = dirname(absServerEntry);
		const serverEntryBase = basename(absServerEntry);
		// Watch the parent directory rather than the file itself —
		// editors that use atomic-write (write to .tmp, rename over)
		// invalidate inode-based file watches after the first save,
		// while directory watches survive the rename and continue to
		// observe future changes.
		const fsWatcher = watch(
			serverEntryDir,
			{ persistent: false },
			(eventType, filename) => {
				if (eventType !== 'change' && eventType !== 'rename') return;
				if (filename !== serverEntryBase) return;
				scheduleServerRestart(absServerEntry);
			}
		);
		fsWatcher.unref();

		// Also watch the absolute.config.ts at the project root.
		// `loadConfig` reads it once at startup; mid-session edits
		// (toggling tailwind, changing a directory, adding HMR
		// options) silently keep the pre-edit config until manual
		// restart. Treating it the same as the server entry —
		// triggering a child-process restart — ensures the new
		// config takes effect.
		const configCandidates = ['absolute.config.ts', 'absolute.config.js'];
		const projectRoot = process.cwd();
		for (const candidate of configCandidates) {
			const absCandidate = resolve(projectRoot, candidate);
			if (!existsSync(absCandidate)) continue;
			const candidateBase = basename(absCandidate);
			const configWatcher = watch(
				dirname(absCandidate),
				{ persistent: false },
				(eventType, filename) => {
					if (eventType !== 'change' && eventType !== 'rename') return;
					if (filename !== candidateBase) return;
					scheduleServerRestart(absCandidate);
				}
			);
			configWatcher.unref();
		}
	} catch (err) {
		console.error(
			cliTag('\x1b[33m', `Failed to set up server entry watcher: ${err}`)
		);
	}

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
		].filter((val): val is string => Boolean(val));
	} catch {
		/* config may not be loadable — frameworks stays empty */
	}

	// Server files are handled by Bun --hot (module re-evaluation without process restart).
	// Frontend files are handled by the HMR file watcher inside the server process.

	sendTelemetryEvent('dev:start', { entry: serverEntry, frameworks });

	const killChildTree = (signal: NodeJS.Signals) => {
		const childPid = serverProcess.pid;
		if (typeof childPid !== 'number') return;
		try {
			// Negative PID → group target. With detached: true the child is
			// the leader of its own group, so this cascades to bun --hot
			// and any of its descendants.
			process.kill(-childPid, signal);

			return;
		} catch {
			/* fall through to single-process kill */
		}
		try {
			process.kill(childPid, signal);
		} catch {
			/* already exited */
		}
	};

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
		killChildTree('SIGTERM');
		await new Promise<void>((res) => {
			if (serverProcess.exitCode !== null) {
				res();

				return;
			}
			serverProcess.once('exit', () => res());
			// Last-resort SIGKILL if the child didn't exit in 2s.
			setTimeout(() => {
				killChildTree('SIGKILL');
			}, 2000).unref();
		});
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
			old.kill('SIGTERM');
		} catch {
			/* already exited */
		}
		serverProcess = spawnServer();
		await new Promise<void>((res) => {
			if (old.exitCode !== null) {
				res();

				return;
			}
			old.once('exit', () => res());
		});
		console.log(cliTag('\x1b[32m', 'Server restarted.'));
	};

	const sendSignalToGroup = (signal: 'SIGSTOP' | 'SIGCONT') => {
		const childPid = serverProcess.pid;
		if (typeof childPid !== 'number') return false;
		try {
			process.kill(-childPid, signal);

			return true;
		} catch {
			return false;
		}
	};

	const sendSignal = (signal: 'SIGSTOP' | 'SIGCONT') => {
		if (sendSignalToGroup(signal)) return;
		const childPid = serverProcess.pid;
		if (typeof childPid !== 'number') return;
		try {
			process.kill(childPid, signal);
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
		const url = `http://${resolvedDev.host === '0.0.0.0' ? 'localhost' : resolvedDev.host}:${port}`;
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
	process.on('exit', () => {
		// Best-effort sync cascade so SIGKILL on the parent process group
		// doesn't strand the child. (process.on('exit') is sync-only.)
		const childPid = serverProcess.pid;
		if (typeof childPid !== 'number') return;
		try {
			process.kill(-childPid, 'SIGTERM');
		} catch {
			/* already exited */
		}
	});

	/** §1.3 (continued) — Detect parent-process death.
	 *
	 *  SIGKILL on the outer `bun dev` package-script wrapper can't run a
	 *  handler. The wrapper dies instantly, this `absolute dev` process
	 *  gets reparented to init (PID 1), and the `bun --hot` grandchild
	 *  it spawned keeps running — bound to the dev port, untouched by
	 *  any cleanup code. Polling `process.ppid` is the only portable
	 *  way to notice (nodemon, PM2 do the same). When the parent
	 *  changes — either it died (we get reparented to init = ppid 1)
	 *  or some other process inherited us — kill the child tree and
	 *  exit ourselves so the orphan doesn't survive. */
	const initialPpid = process.ppid;
	const ppidWatcher = setInterval(() => {
		if (process.ppid !== initialPpid) {
			clearInterval(ppidWatcher);
			cleanup(0);
		}
	}, 1000);
	// Don't keep the event loop alive just for the watcher.
	if (typeof ppidWatcher.unref === 'function') ppidWatcher.unref();

	printHint();

	const handleServerExit = async (exitCode: number | null) => {
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
			exitCode: exitCode ?? -1
		});
		serverProcess = spawnServer();

		return true;
	};

	const monitorServer = async () => {
		if (cleaning) {
			return;
		}
		const current = serverProcess;
		const exitCode = await new Promise<number | null>((res) => {
			if (current.exitCode !== null) {
				res(current.exitCode);

				return;
			}
			current.once('exit', (code) => res(code));
		});
		if (cleaning || serverProcess !== current) {
			await monitorServer();

			return;
		}
		const shouldContinue = await handleServerExit(exitCode);
		if (!shouldContinue) {
			return;
		}

		await monitorServer();
	};

	await monitorServer();
};
