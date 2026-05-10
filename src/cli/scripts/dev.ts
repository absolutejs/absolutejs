import { $, env } from 'bun';
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
	const initialPortProbe = await resolveDevPort(resolvedDev.port, {
		host: resolvedDev.host,
		portRange: resolvedDev.portRange,
		strictPort: resolvedDev.strictPort
	}).catch((err) => {
		console.error(cliTag('\x1b[31m', String(err.message ?? err)));
		process.exit(1);
	});
	let port = initialPortProbe.port;
	if (initialPortProbe.fellBack) {
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

	// Buffered scanner for the `[abs:restart] <path>` marker the dev
	// server emits to stdout when its file watcher observes a change
	// to a file that no HMR pipeline recognized — typically a config
	// file the framework / Bun / TS / tooling reads once at startup
	// (`.env`, `tsconfig.json`, `tailwind.config.ts`, etc.). The
	// parent CLI doesn't try to enumerate those files itself: the dev
	// server already classifies file paths via `detectFramework` and
	// owns the dep graph, so it's the authoritative source for "this
	// file isn't HMR-tracked, restart the process."
	const RESTART_MARKER = '[abs:restart]';
	let restartScanBuffer = '';
	const handleChunk = (value: Buffer) => {
		const text = value.toString('utf8');
		restartScanBuffer += text;
		// Scan and consume complete lines so partial chunks across
		// stream boundaries don't drop or duplicate detections.
		let newlineIdx: number;
		while ((newlineIdx = restartScanBuffer.indexOf('\n')) !== -1) {
			const line = restartScanBuffer.slice(0, newlineIdx);
			restartScanBuffer = restartScanBuffer.slice(newlineIdx + 1);
			const markerIdx = line.indexOf(RESTART_MARKER);
			if (markerIdx === -1) continue;
			const path = line
				.slice(markerIdx + RESTART_MARKER.length)
				.replace(/\x1b\[[0-9;]*m/g, '')
				.trim();
			scheduleServerRestart(path);
		}
		// Cap buffer so a stream of marker-less output never grows
		// unbounded between newlines.
		if (restartScanBuffer.length > 4096) {
			restartScanBuffer = restartScanBuffer.slice(-2048);
		}
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
	// Re-resolve dev-config keys that the spawned child consumes, so an
	// `absolute.config.ts` edit propagates without manually restarting
	// the dev CLI. Currently covers `dev.port` (and the host/portRange/
	// strictPort knobs that feed it). `buildDirectory` is intentionally
	// NOT swapped in-place — the parent CLI holds a directory lock at
	// startup, and silently switching path mid-session leaves the old
	// lock orphaned and old artifacts at the abandoned path. Detect and
	// warn instead.
	let lastBuildDirectoryWarned: string | undefined;
	const refreshDevConfigForSpawn = async () => {
		// Bust the module cache so subsequent spawns re-read the latest
		// config from disk. `loadConfig` uses `import()` which Bun caches
		// by resolved URL; without a cache-busting query param we'd see
		// the same in-memory module on every spawn and silently ignore
		// the user's edit.
		const cfgPath = resolve(
			configPath ?? process.env.ABSOLUTE_CONFIG ?? 'absolute.config.ts'
		);
		let cfg: Awaited<ReturnType<typeof loadConfig>>;
		try {
			const mod = await import(`${cfgPath}?t=${Date.now()}`);
			const raw = mod.default ?? mod.config;
			if (!raw || typeof raw !== 'object') return;
			cfg = raw as typeof cfg;
		} catch {
			return;
		}
		const dev = resolveDevConfig(cfg?.dev);
		const desiredBuildDir = cfg?.buildDirectory
			? resolve(process.cwd(), cfg.buildDirectory)
			: resolve(process.cwd(), 'build');
		if (
			desiredBuildDir !== buildDirectory &&
			desiredBuildDir !== lastBuildDirectoryWarned
		) {
			lastBuildDirectoryWarned = desiredBuildDir;
			console.log(
				cliTag(
					'\x1b[33m',
					`buildDirectory changed in config (${buildDirectory} → ${desiredBuildDir}) — restart \`absolute dev\` to apply (the parent CLI holds a directory lock at the original path).`
				)
			);
		}
		if (
			dev.port !== resolvedDev.port ||
			dev.host !== resolvedDev.host ||
			dev.portRange !== resolvedDev.portRange ||
			dev.strictPort !== resolvedDev.strictPort
		) {
			const probe = await resolveDevPort(dev.port, {
				host: dev.host,
				portRange: dev.portRange,
				strictPort: dev.strictPort
			}).catch((err) => {
				console.error(
					cliTag('\x1b[31m', String(err.message ?? err))
				);
				return undefined;
			});
			if (probe && probe.port !== port) {
				const displayHost =
					dev.host === '0.0.0.0' ? 'localhost' : dev.host;
				console.log(
					cliTag(
						'\x1b[36m',
						`Port changed in config — switching to http://${displayHost}:${probe.port}/`
					)
				);
				port = probe.port;
				updateLockMetadata(buildDirectory, { port });
			}
			resolvedDev = dev;
		}
	};

	// Re-read .env files on every spawn so a `.env` edit propagates
	// to the child without manually restarting the dev CLI. The parent
	// CLI's `process.env` was frozen at parent-startup time, so passing
	// `...process.env` to the child carries stale values; bun's child
	// then refuses to override (since the keys are already set in env).
	// Re-parsing the dotenv files on each spawn and overlaying *on top of*
	// `process.env` gives the latest values without losing inherited
	// system env (PATH, HOME, etc.).
	const readDotenvFiles = (): Record<string, string> => {
		const merged: Record<string, string> = {};
		// Load order matches Bun's: .env, .env.development, .env.local
		// (later wins). Skip files that don't exist.
		const candidates = ['.env', '.env.development', '.env.local'];
		for (const name of candidates) {
			let text: string;
			try {
				text = readFileSync(resolve(process.cwd(), name), 'utf8');
			} catch {
				continue;
			}
			for (const rawLine of text.split('\n')) {
				const line = rawLine.trim();
				if (!line || line.startsWith('#')) continue;
				const eq = line.indexOf('=');
				if (eq === -1) continue;
				const key = line.slice(0, eq).trim();
				let val = line.slice(eq + 1).trim();
				// Strip surrounding quotes if present.
				if (
					(val.startsWith('"') && val.endsWith('"')) ||
					(val.startsWith("'") && val.endsWith("'"))
				) {
					val = val.slice(1, -1);
				}
				merged[key] = val;
			}
		}
		return merged;
	};

	const spawnServer = async (): Promise<ChildProcess> => {
		await refreshDevConfigForSpawn();
		const proc = nodeSpawn(
			'bun',
			['--hot', '--no-clear-screen', serverEntry],
			{
				cwd: process.cwd(),
				detached: true, // new process group → kill cascades
				env: {
					...process.env,
					...readDotenvFiles(),
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

	let serverProcess: ChildProcess = await spawnServer();
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
		const { watch } = await import('node:fs');
		const { dirname, join } = await import('node:path');
		const absServerEntry = resolve(serverEntry);
		const serverEntryDir = dirname(absServerEntry);
		// Watch the project root non-recursively. Two things this covers
		// that the bun child's internal watchers don't:
		//
		// 1. Project-root config files the framework / Bun / TS read once
		//    at startup: `.env`, `tsconfig.json`, `tailwind.config.ts`,
		//    `bun.lock`, `package.json`, custom shell scripts.
		// 2. The server entry itself (`server.ts`). bun --hot's watcher
		//    is unreliable for the entry under our dev runtime — see
		//    BUN_HOT_WATCHER_BUG.md. Until the upstream bug is fixed,
		//    a CLI-level dir watch + child restart is the reliable path.
		//
		// Atomic-write-aware: editors that write `.tmp` then rename
		// invalidate inode-based file watches after the first save,
		// while directory watches survive the rename and continue
		// to observe future changes. We watch the directory and
		// dispatch on the event's filename.
		// Skip build/output directory entries that the dev server
		// itself writes to, plus a few editor-ish suffixes.
		const ROOT_RESTART_DENY = new Set([
			'build',
			'dist',
			'node_modules',
			'.absolutejs',
			'.git',
			'.test-builds',
			'compiled',
			'generated',
			'indexes'
		]);
		// Atomic-write artifacts that exist for milliseconds before being
		// renamed over the real target — firing a restart on them either
		// races the real edit or wastes a cycle.
		const isAtomicWriteTemp = (filename: string) =>
			filename.endsWith('.log') ||
			filename.endsWith('.tmp') ||
			filename.includes('.tmp.') ||
			filename.endsWith('~') ||
			filename.startsWith('.#') ||
			/^sed[A-Za-z0-9]{6,}$/.test(filename) ||
			filename === '4913';
		const watcher = watch(
			serverEntryDir,
			{ recursive: false },
			(_event, filename) => {
				if (!filename) return;
				if (isAtomicWriteTemp(filename)) return;
				if (filename.includes('/') || filename.includes('\\')) {
					return;
				}
				if (ROOT_RESTART_DENY.has(filename)) return;
				scheduleServerRestart(join(serverEntryDir, filename));
			}
		);
		// Stop watcher on parent exit so we don't leak the inotify fd.
		const closeWatcher = () => {
			try {
				watcher.close();
			} catch {
				/* already closed */
			}
		};
		process.once('exit', closeWatcher);
		process.once('SIGINT', closeWatcher);
		process.once('SIGTERM', closeWatcher);

		// (The `[abs:restart]` marker emitted from the bun child's
		// stdout is consumed by `handleChunk` inline as stdout
		// streams in — see definition above. Covers files inside
		// framework / source directories that fall through every
		// HMR pipeline.)
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
		serverProcess = await spawnServer();
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
		serverProcess = await spawnServer();

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
