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
import {
	ANSI_ESCAPE_CODE,
	DEFAULT_PORT,
	HTTP_STATUS_OK,
	WORKSPACE_FAILURE_LOG_PRINT_LIMIT,
	WORKSPACE_FAILURE_RECENT_LOG_LIMIT,
	WORKSPACE_READY_ATTEMPT_TIMEOUT_MS,
	WORKSPACE_READY_PROBE_INTERVAL_MS,
	WORKSPACE_READY_TIMEOUT_MS,
	WORKSPACE_SHUTDOWN_TIMEOUT_MS
} from '../../constants';
import { getWorkspaceServices, loadRawConfig } from '../../utils/loadConfig';
import { getDurationString } from '../../utils/getDurationString';
import { createWorkspaceTui } from '../workspaceTui';
import {
	DEFAULT_SERVER_ENTRY,
	isWSLEnvironment,
	killStaleProcesses
} from '../utils';
import type {
	CommandServiceConfig,
	HttpReadyConfig,
	ServiceConfig,
	ServiceShutdownConfig,
	ServiceVisibility,
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

const ANSI_REGEX = new RegExp(
	`${String.fromCharCode(ANSI_ESCAPE_CODE)}\\[[0-?]*[ -/]*[@-~]`,
	'g'
);

const sleep = (durationMs: number) => Bun.sleep(durationMs);

const stripAnsi = (value: string) => value.replace(ANSI_REGEX, '');

const sanitizeLogFileName = (value: string) =>
	value.replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown';

const createWorkspaceLogSink = (appendLog: WorkspaceLogSink) => {
	const logDirectory = resolve('.absolutejs', 'workspace', 'logs');
	mkdirSync(logDirectory, { recursive: true });

	readdirSync(logDirectory)
		.filter((file) => file.endsWith('.log'))
		.forEach((file) => unlinkSync(resolve(logDirectory, file)));
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
		appendLog: ((source, message, level = 'info') => {
			writeLog(source, message, level);
			appendLog(source, message, level);
		}) satisfies WorkspaceLogSink,
		logDirectory
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
	service.kind === 'command' || Array.isArray(service.command);

const isAbsoluteService = (service: ServiceConfig) =>
	!isCommandService(service);

const getVisibility = (service: ServiceConfig) =>
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
	Array.isArray(value) ? value : [value ?? HTTP_STATUS_OK];

const runSequentially = <Item>(
	items: Item[],
	action: (item: Item) => Promise<void>
) =>
	items.reduce(
		(chain, item) => chain.then(() => action(item)),
		Promise.resolve()
	);

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
		if (!isAbsoluteService(service)) {
			return {
				expectStatus: [HTTP_STATUS_OK],
				headers: {},
				intervalMs: WORKSPACE_READY_PROBE_INTERVAL_MS,
				method: 'GET',
				timeoutMs: WORKSPACE_READY_TIMEOUT_MS,
				type: 'http',
				url: ready
			} satisfies ResolvedHttpReadyProbe;
		}

		const url = resolveServiceHttpUrl(service, ready);

		return {
			expectStatus: [HTTP_STATUS_OK],
			headers: {},
			intervalMs: WORKSPACE_READY_PROBE_INTERVAL_MS,
			method: 'GET',
			timeoutMs: WORKSPACE_READY_TIMEOUT_MS,
			type: 'http',
			url
		} satisfies ResolvedHttpReadyProbe;
	}

	if (ready.path && ready.url) {
		throw new Error(
			'ready HTTP probe cannot define both "path" and "url".'
		);
	}

	const url = resolveHttpReadyProbeUrl(service, ready);
	if (!url) {
		throw new Error('ready HTTP probe requires either "url" or "path".');
	}

	return {
		expectStatus: normalizeExpectedStatuses(ready.expectStatus),
		headers: ready.headers ?? {},
		intervalMs: ready.intervalMs ?? WORKSPACE_READY_PROBE_INTERVAL_MS,
		method: ready.method ?? 'GET',
		timeoutMs: ready.timeoutMs ?? WORKSPACE_READY_TIMEOUT_MS,
		type: 'http',
		url
	} satisfies ResolvedHttpReadyProbe;
};

const resolveHttpReadyProbeUrl = (
	service: ServiceConfig,
	ready: HttpReadyConfig
) => {
	if (ready.path) {
		return resolveServiceHttpUrl(service, ready.path);
	}
	if (ready.url) {
		return ready.url;
	}
	if (isAbsoluteService(service)) {
		return resolveServiceHttpUrl(service, '/hmr-status');
	}

	return null;
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
			host: ready.host ?? getServicePublicHost(service),
			intervalMs: ready.intervalMs ?? WORKSPACE_READY_PROBE_INTERVAL_MS,
			port: ready.port,
			timeoutMs: ready.timeoutMs ?? WORKSPACE_READY_TIMEOUT_MS,
			type: 'tcp'
		} satisfies ResolvedTcpReadyProbe;
	}

	if (ready.type === 'command') {
		return {
			command: ready.command,
			intervalMs: ready.intervalMs ?? WORKSPACE_READY_PROBE_INTERVAL_MS,
			timeoutMs: ready.timeoutMs ?? WORKSPACE_READY_TIMEOUT_MS,
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
	const signal = AbortSignal.timeout(
		Math.min(ready.timeoutMs, WORKSPACE_READY_ATTEMPT_TIMEOUT_MS)
	);
	const response = await fetch(ready.url, {
		headers: ready.headers,
		method: ready.method,
		signal
	});

	return ready.expectStatus.includes(response.status);
};

const probeTcpReady = async (ready: ResolvedTcpReadyProbe) => {
	const { promise, resolve: resolveProbe } = Promise.withResolvers<boolean>();
	const socket = createConnection({
		host: ready.host,
		port: ready.port
	});

	const timeout = setTimeout(
		() => {
			socket.destroy();
			resolveProbe(false);
		},
		Math.min(ready.timeoutMs, WORKSPACE_READY_ATTEMPT_TIMEOUT_MS)
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

	return promise;
};

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
		Math.min(ready.timeoutMs, WORKSPACE_READY_ATTEMPT_TIMEOUT_MS)
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

	const isReady = await pollReady(resolved, service, Date.now());
	if (isReady) {
		return;
	}

	throw new Error(formatReadyTimeoutMessage(resolved));
};

const pollReady = async (
	resolved: Exclude<ResolvedReadyProbe, ResolvedDelayReadyProbe | null>,
	service: ResolvedWorkspaceService,
	startedAt: number
) => {
	if (Date.now() - startedAt >= resolved.timeoutMs) {
		return false;
	}
	if (await probeReady(resolved, service)) {
		return true;
	}

	await sleep(resolved.intervalMs);

	return pollReady(resolved, service, startedAt);
};

const formatReadyTimeoutMessage = (
	resolved: Exclude<ResolvedReadyProbe, ResolvedDelayReadyProbe | null>
) => {
	if (resolved.type === 'http') {
		return `service did not become ready within ${resolved.timeoutMs}ms (${resolved.url})`;
	}
	if (resolved.type === 'tcp') {
		return `service did not become ready within ${resolved.timeoutMs}ms (tcp://${resolved.host}:${resolved.port})`;
	}

	return `service did not become ready within ${resolved.timeoutMs}ms (${resolved.command.join(' ')})`;
};

const probeReady = async (
	resolved: Exclude<ResolvedReadyProbe, ResolvedDelayReadyProbe | null>,
	service: ResolvedWorkspaceService
) => {
	try {
		if (resolved.type === 'http') return probeHttpReady(resolved);
		if (resolved.type === 'tcp') return probeTcpReady(resolved);

		return probeCommandReady(resolved, service);
	} catch {
		return false;
	}
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
			timeoutMs: WORKSPACE_SHUTDOWN_TIMEOUT_MS
		};
	}

	return {
		command: shutdown.command,
		timeoutMs: shutdown.timeoutMs ?? WORKSPACE_SHUTDOWN_TIMEOUT_MS
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
		onLog(
			'workspace',
			exitCode === 0
				? `${service.name} shutdown hook finished.`
				: `${service.name} shutdown hook exited with code ${exitCode || 1}.`,
			exitCode === 0 ? 'success' : 'warn'
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
		const forwardNextChunk = async () => {
			const chunk = await readLogChunk(reader);
			if (chunk === null) {
				appendRemainingLogBuffer(buffer, name, level, appendLog);
				reader.releaseLock();

				return;
			}

			buffer = appendLogChunk(buffer, chunk, name, level, appendLog);
			await forwardNextChunk();
		};

		await forwardNextChunk();
	};

	void forward(processHandle.stdout, 'info');
	void forward(processHandle.stderr, 'error');
};

const readLogChunk = async (
	reader: ReadableStreamDefaultReader<Uint8Array>
) => {
	const { done, value } = await reader.read();
	if (done) return null;
	if (!value) return '';

	return Buffer.from(value).toString();
};

const appendLogChunk = (
	buffer: string,
	chunk: string,
	name: string,
	level: 'info' | 'error',
	appendLog: WorkspaceLogSink
) => {
	const lines = `${buffer}${chunk}`.split('\n');
	const nextBuffer = lines.pop() ?? '';
	lines
		.filter((line) => line.trim().length > 0)
		.forEach((line) => appendLog(name, line, level));

	return nextBuffer;
};

const appendRemainingLogBuffer = (
	buffer: string,
	name: string,
	level: 'info' | 'error',
	appendLog: WorkspaceLogSink
) => {
	if (buffer.trim().length === 0) {
		return;
	}

	appendLog(name, buffer, level);
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

	for (const [name, service] of Object.entries(services).filter(
		([, filteredService]) => Boolean(filteredService.port)
	)) {
		const envKey = `ABSOLUTE_SERVICE_${name
			.toUpperCase()
			.replace(/[^A-Z0-9]+/g, '_')}_URL`;
		workspaceEnv[envKey] =
			`${getServiceProtocol(service)}://${getServicePublicHost(service)}:${service.port}`;
	}

	return workspaceEnv;
};

const getDefinedProcessEnv = () =>
	Object.fromEntries(
		Object.entries(process.env).filter(
			(entry): entry is [string, string] => typeof entry[1] === 'string'
		)
	);

const resolveAbsoluteServiceConfigPath = (
	service: ServiceConfig,
	cwd: string,
	options: WorkspaceDevOptions
) => {
	if (service.config) return resolve(cwd, service.config);
	if (options.configPath) return resolve(options.configPath);
	if (process.env.ABSOLUTE_CONFIG)
		return resolve(process.env.ABSOLUTE_CONFIG);

	return undefined;
};

const resolveService = (
	name: string,
	service: ServiceConfig,
	workspaceEnv: Record<string, string>,
	options: WorkspaceDevOptions
): ResolvedWorkspaceService => {
	const cwd = resolve(service.cwd ?? '.');
	const envVars = Object.assign(
		getDefinedProcessEnv(),
		workspaceEnv,
		service.env,
		{
			ABSOLUTE_WORKSPACE_MANAGED: '1',
			ABSOLUTE_WORKSPACE_SERVICE_NAME: name,
			ABSOLUTE_WORKSPACE_SERVICE_VISIBILITY: getVisibility(service),
			FORCE_COLOR: '1',
			NODE_ENV: 'development'
		}
	);

	if (service.port && !envVars.PORT) {
		envVars.PORT = String(service.port);
	}

	if (isAbsoluteService(service)) {
		const configPath = resolveAbsoluteServiceConfigPath(
			service,
			cwd,
			options
		);

		Object.assign(
			envVars,
			configPath ? { ABSOLUTE_CONFIG: configPath } : {}
		);

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

	const killProcess = (service: RunningService) => {
		try {
			service.process.kill();
		} catch {
			/* process already exited */
		}
	};

	const runShutdownHookSafely = async (service: RunningService) => {
		try {
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
	};

	const killProcesses = async () => {
		const snapshot = [...running];
		running.length = 0;
		snapshot.forEach((service) => killProcess(service));
		await Promise.all(snapshot.map((service) => service.process.exited));
		await runSequentially(snapshot.reverse(), runShutdownHookSafely);
	};

	const appendRecentLogs = (
		lines: string[],
		logsToPrint: ReturnType<typeof tui.getRecentLogs>
	) => {
		if (logsToPrint.length === 0) {
			return;
		}

		lines.push('', 'Recent logs:');
		logsToPrint.forEach((entry) => {
			lines.push(
				`  ${entry.timestamp} [${entry.source}] ${entry.message}`
			);
		});
	};

	const printFailureSummary = (exitCode: number) => {
		const servicesSnapshot = tui.getServiceSnapshot();
		const recentLogs = tui.getRecentLogs(
			WORKSPACE_FAILURE_RECENT_LOG_LIMIT
		);
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
		).slice(-WORKSPACE_FAILURE_LOG_PRINT_LIMIT);
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

		appendRecentLogs(lines, logsToPrint);

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

	const resumeRunningServices = () => {
		running.forEach((service) => {
			sendSignalToService(service.process, 'SIGCONT');
		});
		paused = false;
	};

	const markRunningServicesReady = () => {
		running.forEach((service) => {
			readyServiceNames.add(service.name);
			tui.setServiceStatus(service.name, 'ready');
		});
	};

	const pauseRunningServices = () => {
		running.forEach((service) => {
			sendSignalToService(service.process, 'SIGSTOP');
			readyServiceNames.delete(service.name);
			tui.setServiceStatus(service.name, 'paused');
		});
		paused = true;
	};

	const killStaleServicePort = (port: number) => {
		if (port <= 0) {
			return;
		}

		killStaleProcesses(port, (message) => {
			addLog('workspace', message, 'warn');
		});
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
			resumeRunningServices();
		}
		await killProcesses();
		process.exit(exitCode);
	};

	const handleServiceExit = (
		runningService: RunningService,
		exitCode: number
	) => {
		if (shuttingDown || restarting) {
			return;
		}
		if (!running.includes(runningService)) {
			return;
		}

		const serviceName = runningService.name;
		const normalizedExitCode = exitCode || 1;
		tui.setServiceStatus(
			serviceName,
			'error',
			`exit code ${normalizedExitCode}`
		);
		readyServiceNames.delete(serviceName);
		addLog(
			'workspace',
			`${serviceName} exited with code ${normalizedExitCode}. Shutting down workspace.`,
			'error'
		);
		void shutdown(normalizedExitCode);
	};

	const startService = async (name: string) => {
		const service = services[name];
		if (!service) {
			throw new Error(`services is missing "${name}"`);
		}
		const resolved = resolveService(name, service, workspaceEnv, options);
		const port =
			(resolved.service.port ?? Number(resolved.env.PORT ?? '')) ||
			DEFAULT_PORT;
		killStaleServicePort(port);

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

		void processHandle.exited.then(
			handleServiceExit.bind(null, runningService)
		);

		await waitForReady(resolved);
		const startedAt = serviceBootStartedAt.get(name);
		const readyDuration =
			typeof startedAt === 'number'
				? `ready in ${getDurationString(performance.now() - startedAt)}`
				: undefined;
		readyServiceNames.add(name);
		tui.setServiceStatus(name, 'ready', readyDuration);
	};

	const startServices = async () => {
		tui.setReadyDuration(null);
		await runSequentially(orderedNames, startService);
	};

	const restartWorkspace = async () => {
		if (shuttingDown || restarting) {
			return;
		}
		restarting = true;
		if (paused) {
			resumeRunningServices();
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
			resumeRunningServices();
			markRunningServicesReady();
			paused = false;
			addLog('workspace', 'Workspace resumed.', 'success');
		} else {
			pauseRunningServices();
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
	await Promise.withResolvers<void>().promise;
};
