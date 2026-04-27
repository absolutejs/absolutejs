import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync
} from 'node:fs';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';
import { DEFAULT_PORT } from '../../constants';
import { getWorkspaceServices, loadRawConfig } from '../../utils/loadConfig';
import { getDurationString } from '../../utils/getDurationString';
import { createWorkspaceTui } from '../workspaceTui';
import {
	DEFAULT_SERVER_ENTRY,
	isWSLEnvironment,
	killStaleProcesses
} from '../utils';
import type {
	AbsoluteServiceConfig,
	CommandReadyConfig,
	CommandServiceConfig,
	DelayReadyConfig,
	HttpReadyConfig,
	ServiceConfig,
	ServiceReadyConfig,
	ServiceShutdownConfig,
	ServiceVisibility,
	TcpReadyConfig,
	WorkspaceConfig
} from '../../../types/build';

type WorkspaceDevOptions = {
	configPath?: string;
};

type ResolvedWorkspaceService = {
	name: string;
	service: ServiceConfig;
	cwd: string;
	configPath?: string;
	env: Record<string, string>;
	command: string[];
	visibility: ServiceVisibility;
};

type RunningService = {
	name: string;
	process: Bun.Subprocess<'ignore', 'pipe', 'pipe'>;
	resolved: ResolvedWorkspaceService;
};

type ResolvedShutdownHook = {
	command: string[];
	timeoutMs: number;
};

type WorkspaceLogLevel = 'info' | 'warn' | 'error' | 'success';

type WorkspaceLogSink = (
	source: string,
	message: string,
	level?: WorkspaceLogLevel
) => void;

const ANSI_REGEX = /\x1B\[[0-?]*[ -/]*[@-~]/g;

const sleep = (ms: number) =>
	new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

const stripAnsi = (value: string) => value.replace(ANSI_REGEX, '');

const sanitizeLogFileName = (value: string) =>
	value.replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown';

const createWorkspaceLogSink = (appendLog: WorkspaceLogSink) => {
	const logDirectory = resolve('.absolutejs', 'workspace', 'logs');
	mkdirSync(logDirectory, { recursive: true });

	for (const file of readdirSync(logDirectory)) {
		if (file.endsWith('.log')) {
			unlinkSync(resolve(logDirectory, file));
		}
	}
	writeFileSync(resolve(logDirectory, 'all.log'), '');
	writeFileSync(resolve(logDirectory, 'workspace.log'), '');

	const initializedSources = new Set<string>(['workspace']);
	const writeLog = (
		source: string,
		message: string,
		level: WorkspaceLogLevel
	) => {
		const cleanMessage = stripAnsi(message).trimEnd();
		if (!cleanMessage) {
			return;
		}

		const timestamp = new Date().toISOString();
		const line = `[${timestamp}] [${level}] [${source}] ${cleanMessage}\n`;
		const sourceFile = resolve(
			logDirectory,
			`${sanitizeLogFileName(source)}.log`
		);
		if (!initializedSources.has(source)) {
			writeFileSync(sourceFile, '');
			initializedSources.add(source);
		}
		appendFileSync(sourceFile, line);
		appendFileSync(resolve(logDirectory, 'all.log'), line);
	};

	return {
		logDirectory,
		appendLog: ((source, message, level = 'info') => {
			writeLog(source, message, level);
			appendLog(source, message, level);
		}) satisfies WorkspaceLogSink
	};
};

const readPackageVersion = (candidate: string) => {
	try {
		const pkg = JSON.parse(readFileSync(candidate, 'utf-8'));
		if (pkg.name !== '@absolutejs/absolute') {
			return null;
		}

		const { version } = pkg;

		return version;
	} catch {
		return null;
	}
};

const resolvePackageVersion = () => {
	const candidates = [
		resolve(import.meta.dir, '..', '..', 'package.json'),
		resolve(import.meta.dir, '..', '..', '..', 'package.json'),
		resolve(import.meta.dir, '..', '..', '..', '..', 'package.json')
	];

	for (const candidate of candidates) {
		const version = readPackageVersion(candidate);
		if (version) {
			return version;
		}
	}

	return process.env.ABSOLUTE_VERSION || 'unknown';
};

const isCommandService = (
	service: ServiceConfig
): service is CommandServiceConfig =>
	service.kind === 'command' ||
	Array.isArray((service as { command?: unknown }).command);

const isAbsoluteService = (
	service: ServiceConfig
): service is AbsoluteServiceConfig => !isCommandService(service);

const getVisibility = (service: ServiceConfig): ServiceVisibility =>
	service.visibility ?? 'public';

const getServiceUrl = (service: ServiceConfig) => {
	if (!service.port) {
		return null;
	}

	return `${getServiceProtocol(service)}://${getServicePublicHost(service)}:${service.port}/`;
};

const getDefaultReadyConfig = (service: ServiceConfig) => {
	if (isAbsoluteService(service) && service.port) {
		return '/hmr-status';
	}

	return undefined;
};

type ResolvedHttpReadyProbe = {
	type: 'http';
	url: string;
	method: 'GET' | 'HEAD';
	expectStatus: number[];
	headers: Record<string, string>;
	intervalMs: number;
	timeoutMs: number;
};

type ResolvedTcpReadyProbe = {
	type: 'tcp';
	host: string;
	port: number;
	intervalMs: number;
	timeoutMs: number;
};

type ResolvedCommandReadyProbe = {
	type: 'command';
	command: string[];
	intervalMs: number;
	timeoutMs: number;
};

type ResolvedDelayReadyProbe = {
	type: 'delay';
	ms: number;
};

type ResolvedReadyProbe =
	| ResolvedHttpReadyProbe
	| ResolvedTcpReadyProbe
	| ResolvedCommandReadyProbe
	| ResolvedDelayReadyProbe
	| null;

const normalizeExpectedStatuses = (value?: number | number[]) =>
	Array.isArray(value) ? value : [value ?? 200];

const resolveServiceHttpUrl = (service: ServiceConfig, path: string) => {
	if (!path.startsWith('/')) {
		throw new Error(
			`ready path must start with "/" for service probes. Received "${path}".`
		);
	}
	if (!service.port) {
		throw new Error(
			`ready path "${path}" requires the service to define a port.`
		);
	}

	return `${getServiceProtocol(service)}://${getServicePublicHost(service)}:${service.port}${path}`;
};

const resolveHttpReadyProbe = (
	service: ServiceConfig,
	ready: string | HttpReadyConfig
) => {
	if (typeof ready === 'string') {
		if (isAbsoluteService(service)) {
			return {
				type: 'http',
				url: resolveServiceHttpUrl(service, ready),
				method: 'GET',
				expectStatus: [200],
				headers: {},
				intervalMs: 250,
				timeoutMs: 30_000
			} satisfies ResolvedHttpReadyProbe;
		}

		return {
			expectStatus: [200],
			headers: {},
			intervalMs: 250,
			method: 'GET',
			timeoutMs: 30_000,
			type: 'http',
			url: ready
		} satisfies ResolvedHttpReadyProbe;
	}

	if (ready.path && ready.url) {
		throw new Error(
			'ready HTTP probe cannot define both "path" and "url".'
		);
	}

	const url = ready.path
		? resolveServiceHttpUrl(service, ready.path)
		: ready.url
			? ready.url
			: isAbsoluteService(service)
				? resolveServiceHttpUrl(service, '/hmr-status')
				: null;
	if (!url) {
		throw new Error('ready HTTP probe requires either "url" or "path".');
	}

	return {
		type: 'http',
		url,
		method: ready.method ?? 'GET',
		expectStatus: normalizeExpectedStatuses(ready.expectStatus),
		headers: ready.headers ?? {},
		intervalMs: ready.intervalMs ?? 250,
		timeoutMs: ready.timeoutMs ?? 30_000
	} satisfies ResolvedHttpReadyProbe;
};

const resolveReadyProbe = (
	service: ServiceConfig,
	ready = service.ready ?? getDefaultReadyConfig(service)
) => {
	if (ready === false || !ready) {
		return null;
	}

	if (typeof ready === 'string') {
		return resolveHttpReadyProbe(service, ready);
	}

	if (ready.type === 'tcp') {
		return {
			type: 'tcp',
			host: ready.host ?? getServicePublicHost(service),
			port: ready.port,
			intervalMs: ready.intervalMs ?? 250,
			timeoutMs: ready.timeoutMs ?? 30_000
		} satisfies ResolvedTcpReadyProbe;
	}

	if (ready.type === 'command') {
		return {
			command: ready.command,
			intervalMs: ready.intervalMs ?? 250,
			timeoutMs: ready.timeoutMs ?? 30_000,
			type: 'command'
		} satisfies ResolvedCommandReadyProbe;
	}

	if (ready.type === 'delay') {
		return {
			ms: ready.ms,
			type: 'delay'
		} satisfies ResolvedDelayReadyProbe;
	}

	return resolveHttpReadyProbe(service, ready);
};

const probeHttpReady = async (ready: ResolvedHttpReadyProbe) => {
	const response = await fetch(ready.url, {
		method: ready.method,
		headers: ready.headers,
		signal: AbortSignal.timeout(Math.min(ready.timeoutMs, 5_000))
	});

	return ready.expectStatus.includes(response.status);
};

const probeTcpReady = async (ready: ResolvedTcpReadyProbe) =>
	new Promise<boolean>((resolveProbe) => {
		const socket = createConnection({
			host: ready.host,
			port: ready.port
		});

		const timeout = setTimeout(
			() => {
				socket.destroy();
				resolveProbe(false);
			},
			Math.min(ready.timeoutMs, 5_000)
		);

		socket.once('connect', () => {
			clearTimeout(timeout);
			socket.end();
			resolveProbe(true);
		});
		socket.once('error', () => {
			clearTimeout(timeout);
			socket.destroy();
			resolveProbe(false);
		});
	});

const probeCommandReady = async (
	ready: ResolvedCommandReadyProbe,
	service: ResolvedWorkspaceService
) => {
	const processHandle = Bun.spawn(ready.command, {
		cwd: service.cwd,
		env: service.env,
		stderr: 'ignore',
		stdin: 'ignore',
		stdout: 'ignore'
	});
	const timeout = setTimeout(
		() => {
			try {
				processHandle.kill();
			} catch {
				/* process already exited */
			}
		},
		Math.min(ready.timeoutMs, 5_000)
	);

	try {
		const exitCode = await processHandle.exited;

		return exitCode === 0;
	} finally {
		clearTimeout(timeout);
	}
};

const waitForReady = async (service: ResolvedWorkspaceService) => {
	const resolved = resolveReadyProbe(service.service);
	if (!resolved) {
		return;
	}

	if (resolved.type === 'delay') {
		await sleep(resolved.ms);

		return;
	}

	const startedAt = Date.now();
	while (Date.now() - startedAt < resolved.timeoutMs) {
		try {
			const isReady =
				resolved.type === 'http'
					? await probeHttpReady(resolved)
					: resolved.type === 'tcp'
						? await probeTcpReady(resolved)
						: await probeCommandReady(resolved, service);
			if (isReady) {
				return;
			}
		} catch {
			/* service not ready yet */
		}

		// eslint-disable-next-line no-await-in-loop -- readiness probes must poll sequentially
		await sleep(resolved.intervalMs);
	}

	throw new Error(
		resolved.type === 'http'
			? `service did not become ready within ${resolved.timeoutMs}ms (${resolved.url})`
			: resolved.type === 'tcp'
				? `service did not become ready within ${resolved.timeoutMs}ms (tcp://${resolved.host}:${resolved.port})`
				: `service did not become ready within ${resolved.timeoutMs}ms (${resolved.command.join(' ')})`
	);
};

const resolveShutdownHook = (
	shutdown: ServiceShutdownConfig | undefined
): ResolvedShutdownHook | null => {
	if (!shutdown) {
		return null;
	}

	if (Array.isArray(shutdown)) {
		return {
			command: shutdown,
			timeoutMs: 10_000
		};
	}

	return {
		command: shutdown.command,
		timeoutMs: shutdown.timeoutMs ?? 10_000
	};
};

const runShutdownHook = async (
	service: ResolvedWorkspaceService,
	onLog: (
		source: string,
		message: string,
		level?: 'info' | 'warn' | 'error' | 'success'
	) => void
) => {
	const hook = resolveShutdownHook(service.service.shutdown);
	if (!hook) {
		return;
	}

	onLog('workspace', `Running ${service.name} shutdown hook...`, 'info');
	const processHandle = Bun.spawn(hook.command, {
		cwd: service.cwd,
		env: service.env,
		stderr: 'pipe',
		stdin: 'ignore',
		stdout: 'pipe'
	});

	pipeProcessLogs(service.name, processHandle, onLog);
	const timeout = setTimeout(() => {
		try {
			processHandle.kill();
		} catch {
			/* process already exited */
		}
	}, hook.timeoutMs);

	try {
		const exitCode = await processHandle.exited;
		if (exitCode === 0) {
			onLog(
				'workspace',
				`${service.name} shutdown hook finished.`,
				'success'
			);

			return;
		}
		onLog(
			'workspace',
			`${service.name} shutdown hook exited with code ${exitCode || 1}.`,
			'warn'
		);
	} finally {
		clearTimeout(timeout);
	}
};

const topologicallySortServices = (services: Record<string, ServiceConfig>) => {
	const ordered: string[] = [];
	const visiting = new Set<string>();
	const visited = new Set<string>();

	const visit = (name: string) => {
		if (visited.has(name)) {
			return;
		}
		if (visiting.has(name)) {
			throw new Error(
				`services has a dependency cycle involving "${name}"`
			);
		}

		const service = services[name];
		if (!service) {
			throw new Error(`services references unknown service "${name}"`);
		}

		visiting.add(name);
		for (const dependency of service.dependsOn ?? []) {
			if (!services[dependency]) {
				throw new Error(
					`services.${name} depends on missing service "${dependency}"`
				);
			}
			visit(dependency);
		}
		visiting.delete(name);
		visited.add(name);
		ordered.push(name);
	};

	for (const name of Object.keys(services)) {
		visit(name);
	}

	return ordered;
};

const pipeProcessLogs = (
	name: string,
	processHandle: Bun.Subprocess<'ignore', 'pipe', 'pipe'>,
	appendLog: WorkspaceLogSink
) => {
	const forward = async (
		stream: ReadableStream<Uint8Array>,
		level: 'info' | 'error'
	) => {
		let buffer = '';
		const reader = stream.getReader();
		try {
			while (true) {
				// eslint-disable-next-line no-await-in-loop -- log chunks must preserve order
				const { done, value } = await reader.read();
				if (done) {
					break;
				}
				if (!value) {
					continue;
				}

				buffer += Buffer.from(value).toString();
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';
				for (const line of lines) {
					if (line.trim().length === 0) {
						continue;
					}
					appendLog(name, line, level);
				}
			}
		} finally {
			if (buffer.trim().length > 0) {
				appendLog(name, buffer, level);
			}
			reader.releaseLock();
		}
	};

	void forward(processHandle.stdout, 'info');
	void forward(processHandle.stderr, 'error');
};

const getServicePublicHost = (service: ServiceConfig) => {
	const host = service.env?.HOST ?? process.env.HOST ?? 'localhost';
	if (host === '0.0.0.0' || host === '::') {
		return 'localhost';
	}

	return host;
};

const getServiceProtocol = (service: ServiceConfig) =>
	service.env?.ABSOLUTE_HTTPS === 'true' ||
	process.env.ABSOLUTE_HTTPS === 'true'
		? 'https'
		: 'http';

const createWorkspaceServiceEnv = (services: WorkspaceConfig) => {
	const workspaceEnv: Record<string, string> = {};

	for (const [name, service] of Object.entries(services)) {
		if (!service.port) {
			continue;
		}

		const envKey = `ABSOLUTE_SERVICE_${name
			.toUpperCase()
			.replace(/[^A-Z0-9]+/g, '_')}_URL`;
		workspaceEnv[envKey] =
			`${getServiceProtocol(service)}://${getServicePublicHost(service)}:${service.port}`;
	}

	return workspaceEnv;
};

const resolveService = (
	name: string,
	service: ServiceConfig,
	workspaceEnv: Record<string, string>,
	options: WorkspaceDevOptions
): ResolvedWorkspaceService => {
	const cwd = resolve(service.cwd ?? '.');
	const envVars = {
		...process.env,
		...workspaceEnv,
		...service.env,
		ABSOLUTE_WORKSPACE_MANAGED: '1',
		ABSOLUTE_WORKSPACE_SERVICE_NAME: name,
		ABSOLUTE_WORKSPACE_SERVICE_VISIBILITY: getVisibility(service),
		FORCE_COLOR: '1',
		NODE_ENV: 'development'
	} as Record<string, string>;

	if (service.port && !envVars.PORT) {
		envVars.PORT = String(service.port);
	}

	if (isAbsoluteService(service)) {
		const configPath = service.config
			? resolve(cwd, service.config)
			: options.configPath
				? resolve(options.configPath)
				: process.env.ABSOLUTE_CONFIG
					? resolve(process.env.ABSOLUTE_CONFIG)
					: undefined;

		if (configPath) {
			envVars.ABSOLUTE_CONFIG = configPath;
		}

		const command = [
			process.execPath,
			'--hot',
			'--no-clear-screen',
			service.entry ?? DEFAULT_SERVER_ENTRY
		];

		return {
			command,
			configPath,
			cwd,
			env: envVars,
			name,
			service,
			visibility: getVisibility(service)
		};
	}

	return {
		command: service.command,
		cwd,
		env: envVars,
		name,
		service,
		visibility: getVisibility(service)
	};
};

export const workspace = async (
	subcommand: string | undefined,
	options: WorkspaceDevOptions
) => {
	if (subcommand !== 'dev') {
		throw new Error(
			subcommand
				? `Unknown workspace command: ${subcommand}`
				: 'No workspace subcommand specified. Use `absolute workspace dev`.'
		);
	}

	const config = await loadRawConfig(options.configPath);
	const services = getWorkspaceServices(config);
	const workspaceEnv = createWorkspaceServiceEnv(services);
	const orderedNames = topologicallySortServices(services);
	const running: RunningService[] = [];
	const serviceBootStartedAt = new Map<string, number>();
	const readyServiceNames = new Set<string>();
	let shuttingDown = false;
	let restarting = false;
	let paused = false;
	let workspaceBootStartedAt = performance.now();
	const absoluteVersion = resolvePackageVersion();
	const tui = createWorkspaceTui({
		actions: {
			open: () => openInBrowser(),
			pause: () => {
				togglePause();
			},
			quit: () => {
				void shutdown(0);
			},
			restart: () => restartWorkspace(),
			shell: (command) => runShellCommand(command)
		},
		services: orderedNames.map((name) => {
			const service = services[name];

			return {
				name,
				port: service?.port,
				url: service ? getServiceUrl(service) : null,
				visibility: service ? getVisibility(service) : 'public'
			};
		}),
		version: absoluteVersion
	});
	const workspaceLogs = createWorkspaceLogSink(tui.addLog);
	const addLog = workspaceLogs.appendLog;

	const killProcesses = async () => {
		const snapshot = [...running];
		running.length = 0;
		for (const service of snapshot) {
			try {
				service.process.kill();
			} catch {
				/* process already exited */
			}
		}
		await Promise.all(snapshot.map((service) => service.process.exited));
		for (const service of snapshot.reverse()) {
			try {
				// eslint-disable-next-line no-await-in-loop -- shutdown hooks should run in reverse service order
				await runShutdownHook(service.resolved, addLog);
			} catch (error) {
				const message =
					error instanceof Error ? error.message : String(error);
				addLog(
					'workspace',
					`${service.name} shutdown hook failed: ${message}`,
					'warn'
				);
			}
		}
	};

	const printFailureSummary = (exitCode: number) => {
		const servicesSnapshot = tui.getServiceSnapshot();
		const recentLogs = tui.getRecentLogs(60);
		const failedServices = servicesSnapshot.filter(
			(service) => service.status === 'error'
		);
		const relevantLogs = recentLogs.filter(
			(entry) =>
				entry.level === 'error' ||
				entry.level === 'warn' ||
				entry.source === 'workspace' ||
				failedServices.some((service) => service.name === entry.source)
		);
		const logsToPrint = (
			relevantLogs.length > 0 ? relevantLogs : recentLogs
		).slice(-30);
		const lines = [
			'',
			`\x1b[31mABSOLUTEJS WORKSPACE exited with code ${exitCode}\x1b[0m`,
			'',
			'Services:',
			...servicesSnapshot.map((service) => {
				const detail = service.detail ? ` · ${service.detail}` : '';

				return `  - ${service.name}: ${service.status} · ${service.target}${detail}`;
			})
		];

		if (logsToPrint.length > 0) {
			lines.push('', 'Recent logs:');
			for (const entry of logsToPrint) {
				lines.push(
					`  ${entry.timestamp} [${entry.source}] ${entry.message}`
				);
			}
		}

		lines.push('');
		process.stderr.write(`${lines.join('\n')}\n`);
	};

	const sendSignalToService = (
		processHandle: Bun.Subprocess<'ignore', 'pipe', 'pipe'>,
		signal: 'SIGSTOP' | 'SIGCONT'
	) => {
		try {
			process.kill(-processHandle.pid, signal);

			return;
		} catch {
			/* fall back to direct pid */
		}

		try {
			process.kill(processHandle.pid, signal);
		} catch {
			/* process already exited */
		}
	};

	const shutdown = async (exitCode = 0) => {
		if (shuttingDown) {
			return;
		}
		shuttingDown = true;
		const shouldPrintFailureSummary = exitCode !== 0;
		tui.dispose();
		if (shouldPrintFailureSummary) {
			printFailureSummary(exitCode);
		}
		if (paused) {
			for (const service of running) {
				sendSignalToService(service.process, 'SIGCONT');
			}
			paused = false;
		}
		await killProcesses();
		process.exit(exitCode);
	};

	const startServices = async () => {
		tui.setReadyDuration(null);
		for (const name of orderedNames) {
			const service = services[name];
			if (!service) {
				throw new Error(`services is missing "${name}"`);
			}
			const resolved = resolveService(
				name,
				service,
				workspaceEnv,
				options
			);
			const port =
				(resolved.service.port ?? Number(resolved.env.PORT ?? '')) ||
				DEFAULT_PORT;
			if (port > 0) {
				killStaleProcesses(port, (message) => {
					addLog('workspace', message, 'warn');
				});
			}

			if (
				isAbsoluteService(resolved.service) &&
				resolved.configPath &&
				!existsSync(resolved.configPath)
			) {
				throw new Error(
					`${name} references missing config "${resolved.configPath}"`
				);
			}

			serviceBootStartedAt.set(name, performance.now());
			readyServiceNames.delete(name);
			tui.setServiceStatus(name, restarting ? 'restarting' : 'starting');

			const processHandle = Bun.spawn(resolved.command, {
				cwd: resolved.cwd,
				env: resolved.env,
				stderr: 'pipe',
				stdin: 'ignore',
				stdout: 'pipe'
			});

			pipeProcessLogs(name, processHandle, addLog);
			const runningService: RunningService = {
				name,
				process: processHandle,
				resolved
			};
			running.push(runningService);

			void processHandle.exited.then((exitCode) => {
				if (shuttingDown || restarting) {
					return;
				}
				if (!running.includes(runningService)) {
					return;
				}
				tui.setServiceStatus(
					name,
					'error',
					`exit code ${exitCode || 1}`
				);
				readyServiceNames.delete(name);
				addLog(
					'workspace',
					`${name} exited with code ${exitCode || 1}. Shutting down workspace.`,
					'error'
				);
				void shutdown(exitCode || 1);
			});

			// eslint-disable-next-line no-await-in-loop -- dependent services must start in a stable order
			await waitForReady(resolved);
			const startedAt = serviceBootStartedAt.get(name);
			const readyDuration =
				typeof startedAt === 'number'
					? `ready in ${getDurationString(performance.now() - startedAt)}`
					: undefined;
			readyServiceNames.add(name);
			tui.setServiceStatus(name, 'ready', readyDuration);
		}
	};

	const restartWorkspace = async () => {
		if (shuttingDown || restarting) {
			return;
		}
		restarting = true;
		if (paused) {
			for (const service of running) {
				sendSignalToService(service.process, 'SIGCONT');
			}
			paused = false;
		}
		addLog('workspace', 'Restarting workspace...', 'info');
		readyServiceNames.clear();
		for (const name of orderedNames) {
			tui.setServiceStatus(name, 'restarting');
		}
		await killProcesses();
		restarting = false;
		workspaceBootStartedAt = performance.now();
		await startServices();
		tui.setReadyDuration(performance.now() - workspaceBootStartedAt);
	};

	const togglePause = () => {
		if (paused) {
			for (const service of running) {
				sendSignalToService(service.process, 'SIGCONT');
				readyServiceNames.add(service.name);
				tui.setServiceStatus(service.name, 'ready');
			}
			paused = false;
			addLog('workspace', 'Workspace resumed.', 'success');
		} else {
			for (const service of running) {
				sendSignalToService(service.process, 'SIGSTOP');
				readyServiceNames.delete(service.name);
				tui.setServiceStatus(service.name, 'paused');
			}
			paused = true;
			addLog('workspace', 'Workspace paused.', 'warn');
		}
	};

	const runShellCommand = async (command: string) => {
		const processHandle = Bun.spawn(['bash', '-lc', command], {
			env: { ...process.env, FORCE_COLOR: '1' },
			stderr: 'pipe',
			stdout: 'pipe'
		});
		pipeProcessLogs('shell', processHandle, addLog);
		const exitCode = await processHandle.exited;
		if (exitCode === 0) {
			addLog(
				'workspace',
				`Shell command finished: ${command}`,
				'success'
			);

			return;
		}
		addLog(
			'workspace',
			`Shell command failed with exit code ${exitCode}: ${command}`,
			'error'
		);
	};

	const openInBrowser = async () => {
		const publicEntry = orderedNames
			.map((name) => ({ name, service: services[name] }))
			.find(
				({ name, service }) =>
					service &&
					getVisibility(service) === 'public' &&
					readyServiceNames.has(name)
			);
		const url = publicEntry?.service
			? getServiceUrl(publicEntry.service)
			: null;
		if (!url) {
			addLog('workspace', 'No ready public service to open yet.', 'warn');

			return;
		}

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
			addLog('workspace', `Opening ${url}`, 'info');
		} catch {
			addLog(
				'workspace',
				`Could not open browser automatically. Visit ${url}`,
				'warn'
			);
		}
	};

	process.on('SIGINT', () => {
		void shutdown(0);
	});
	process.on('SIGTERM', () => {
		void shutdown(0);
	});

	tui.start();
	await startServices();
	tui.setReadyDuration(performance.now() - workspaceBootStartedAt);
	await new Promise<void>(() => {
		/* keep process alive until shutdown */
	});
};
