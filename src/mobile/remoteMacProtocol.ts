/* eslint-disable @typescript-eslint/consistent-type-assertions, absolute/max-depth-extended, no-await-in-loop -- This module validates persisted/remote input and consumes protocol streams sequentially. */
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import {
	dirname,
	isAbsolute,
	join,
	posix,
	relative,
	resolve as resolvePath,
	sep
} from 'node:path';
import type { MobileConfig } from '../../types/build';
import type { FileSink } from 'bun';
import type { NormalizedAbsoluteMobileConfig } from './config';
import type {
	AbsoluteIosDevPhaseTiming,
	AbsoluteIosDevSession,
	AbsoluteIosDevState,
	AbsoluteIosNativeLogEntry
} from './iosSimulatorController';
import {
	ABSOLUTE_REMOTE_MAC_EVENT_PREFIX,
	ABSOLUTE_REMOTE_MAC_PROTOCOL_VERSION
} from './remoteMacWire';
export {
	ABSOLUTE_REMOTE_MAC_EVENT_PREFIX,
	ABSOLUTE_REMOTE_MAC_PROTOCOL_VERSION
} from './remoteMacWire';

const PROFILE_FORMAT = 1;
const PROFILE_NAME = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/u;
const SSH_DESTINATION = /^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9._:-]+$/u;

export type AbsoluteRemoteMacProfile = {
	bunPath: string;
	createdAt: string;
	destination: string;
	name: string;
	port?: number;
	workspaceRoot: string;
	xcodeVersion: string;
};

type ProfileStore = {
	defaultProfile?: string;
	format: number;
	profiles: Record<string, AbsoluteRemoteMacProfile>;
};

export type AbsoluteRemoteMacInspection = {
	bunPath: string;
	home: string;
	os: string;
	xcodeVersion: string;
};

export type AbsoluteRemoteIosDevProject = {
	cap: string;
	config: NormalizedAbsoluteMobileConfig;
	nativeDirectory: string;
	projectRoot: string;
	profile: AbsoluteRemoteMacProfile;
	remoteProjectRoot: string;
	remote: true;
	xcodebuild: string;
	xcrun: string;
};

export type AbsoluteIosDevelopmentProject =
	| AbsoluteRemoteIosDevProject
	| (import('./iosSimulatorController').AbsoluteIosDevProject & {
			remote?: false;
	  });

export type AbsoluteRemoteMacCommandResult = {
	exitCode: number;
	stderr: string;
	stdout: string;
};

export type AbsoluteRemoteMacTransport = {
	capture: (command: string[]) => Promise<AbsoluteRemoteMacCommandResult>;
	spawn: (
		command: string[],
		options: { signal?: AbortSignal }
	) => {
		exited: Promise<number>;
		kill: () => void;
		stderr: ReadableStream<Uint8Array>;
		stdin: FileSink;
		stdout: ReadableStream<Uint8Array>;
	};
};

export type AbsoluteRemoteIosOptions = {
	https?: boolean;
	log?: (message: string) => void;
	nativeLog?: (entry: AbsoluteIosNativeLogEntry) => void;
	onPhaseTiming?: (timing: AbsoluteIosDevPhaseTiming) => void;
	onStateChange?: (state: AbsoluteIosDevState) => void;
	port: number;
	project: AbsoluteRemoteIosDevProject;
	signal?: AbortSignal;
	installAgent?: (
		project: AbsoluteRemoteIosDevProject
	) => Promise<{ remotePath: string; uploaded?: boolean }>;
	syncProject?: (project: AbsoluteRemoteIosDevProject) => Promise<void>;
	transport?: AbsoluteRemoteMacTransport;
};

type RemoteEvent =
	| { entry: AbsoluteIosNativeLogEntry; type: 'native-log'; v: 1 }
	| { error: string; type: 'fatal'; v: 1 }
	| { message: string; type: 'log'; v: 1 }
	| { state: AbsoluteIosDevState; type: 'state'; v: 1 }
	| ({ type: 'timing'; v: 1 } & AbsoluteIosDevPhaseTiming)
	| {
			id: string;
			ok: boolean;
			result?: unknown;
			error?: string;
			type: 'response';
			v: 1;
	  }
	| {
			nativeCacheHit: boolean;
			startedSimulator: boolean;
			timings: Record<string, number>;
			type: 'ready';
			udid: string;
			v: 1;
	  };

const defaultProfilePath = () =>
	join(homedir(), '.absolutejs', 'mobile', 'remote-macs.json');

const emptyStore = (): ProfileStore => ({
	format: PROFILE_FORMAT,
	profiles: {}
});

const loadStore = async (path = defaultProfilePath()) => {
	try {
		const parsed = JSON.parse(await readFile(path, 'utf8')) as ProfileStore;
		if (
			parsed.format !== PROFILE_FORMAT ||
			typeof parsed.profiles !== 'object' ||
			parsed.profiles === null ||
			Array.isArray(parsed.profiles)
		)
			throw new Error('Unsupported remote Mac profile format.');
		for (const [key, profile] of Object.entries(parsed.profiles)) {
			if (
				typeof profile !== 'object' ||
				profile === null ||
				validateAbsoluteRemoteMacProfileName(key) !== key ||
				profile.name !== key ||
				validateAbsoluteSshDestination(profile.destination) !==
					profile.destination ||
				validatePort(profile.port) !== profile.port ||
				typeof profile.createdAt !== 'string' ||
				!profile.createdAt ||
				typeof profile.bunPath !== 'string' ||
				!profile.bunPath.startsWith('/') ||
				/[\r\n\0]/u.test(profile.bunPath) ||
				typeof profile.workspaceRoot !== 'string' ||
				!profile.workspaceRoot.startsWith('/') ||
				profile.workspaceRoot === '/' ||
				/[\r\n\0]/u.test(profile.workspaceRoot) ||
				typeof profile.xcodeVersion !== 'string' ||
				!profile.xcodeVersion.startsWith('Xcode ')
			)
				throw new Error(
					`Remote Mac profile ${JSON.stringify(key)} is invalid.`
				);
		}
		if (
			parsed.defaultProfile !== undefined &&
			!parsed.profiles[parsed.defaultProfile]
		)
			throw new Error('The default remote Mac profile does not exist.');

		return parsed;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT')
			return emptyStore();
		throw error;
	}
};

const saveStore = async (store: ProfileStore, path = defaultProfilePath()) => {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${randomUUID()}.tmp`;
	await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, {
		mode: 0o600
	});
	await rename(temporary, path);
	await chmod(path, 0o600);
};

export const validateAbsoluteRemoteMacProfileName = (name: string) => {
	const normalized = name.trim().toLowerCase();
	if (!PROFILE_NAME.test(normalized))
		throw new TypeError(
			'Remote Mac profile names must use 1-64 lowercase letters, digits, dots, dashes, or underscores.'
		);

	return normalized;
};

export const validateAbsoluteSshDestination = (destination: string) => {
	const normalized = destination.trim();
	if (!SSH_DESTINATION.test(normalized) || normalized.startsWith('-'))
		throw new TypeError(
			'Remote Mac SSH destination must be a host, SSH alias, or user@host without command-line options.'
		);

	return normalized;
};

const validatePort = (port: number | undefined) => {
	if (
		port !== undefined &&
		(!Number.isInteger(port) || port < 1 || port > 65_535)
	)
		throw new TypeError('Remote Mac SSH port must be between 1 and 65535.');

	return port;
};

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export const absoluteRemoteMacSshBase = (
	profile: Pick<AbsoluteRemoteMacProfile, 'destination' | 'port'>,
	options: { acceptNew?: boolean } = {}
) => [
	'ssh',
	'-o',
	'BatchMode=yes',
	'-o',
	'ConnectTimeout=10',
	'-o',
	'ServerAliveInterval=15',
	'-o',
	'ServerAliveCountMax=3',
	'-o',
	`StrictHostKeyChecking=${options.acceptNew ? 'accept-new' : 'yes'}`,
	...(profile.port ? ['-p', String(profile.port)] : []),
	profile.destination
];

const localCapture = async (command: string[]) => {
	const process = Bun.spawn(command, {
		stderr: 'pipe',
		stdin: 'ignore',
		stdout: 'pipe'
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		process.exited,
		new Response(process.stdout).text(),
		new Response(process.stderr).text()
	]);

	return { exitCode, stderr, stdout };
};

const defaultTransport: AbsoluteRemoteMacTransport = {
	capture: localCapture,
	spawn: (command, options) =>
		Bun.spawn(command, {
			signal: options.signal,
			stderr: 'pipe',
			stdin: 'pipe',
			stdout: 'pipe'
		}) as ReturnType<AbsoluteRemoteMacTransport['spawn']>
};

const requireRemoteSuccess = (
	result: AbsoluteRemoteMacCommandResult,
	label: string
) => {
	if (result.exitCode !== 0)
		throw new Error(
			`${label} failed: ${(result.stderr || result.stdout).trim() || `status ${result.exitCode}`}`
		);

	return result.stdout.trim();
};

export const getAbsoluteRemoteMacProfile = async (
	name?: string,
	profilePath?: string
) => {
	const store = await loadStore(profilePath);
	const selected =
		name ?? process.env.ABSOLUTE_IOS_REMOTE ?? store.defaultProfile;
	if (!selected) return undefined;
	const profile = store.profiles[selected];
	if (!profile)
		throw new Error(
			`Remote Mac profile ${JSON.stringify(selected)} was not found.`
		);

	return profile;
};
export const inspectAbsoluteRemoteMac = async (
	destination: string,
	options: {
		acceptNew?: boolean;
		port?: number;
		transport?: Pick<AbsoluteRemoteMacTransport, 'capture'>;
	} = {}
) => {
	const profile: Pick<AbsoluteRemoteMacProfile, 'destination' | 'port'> = {
		destination: validateAbsoluteSshDestination(destination),
		port: validatePort(options.port)
	};
	const capture = options.transport?.capture ?? defaultTransport.capture;
	const command = [
		...absoluteRemoteMacSshBase(profile, {
			acceptNew: options.acceptNew === true
		}),
		'/bin/sh -lc',
		shellQuote(
			`bun_path="$(command -v bun || true)"; if [ -z "$bun_path" ] && [ -x "$HOME/.bun/bin/bun" ]; then bun_path="$HOME/.bun/bin/bun"; fi; printf '%s\\n' "$(uname -s)" "$HOME" "$bun_path" "$(/usr/bin/xcodebuild -version 2>/dev/null | tr '\\n' ' ' || true)"`
		)
	];
	const lines = requireRemoteSuccess(
		await capture(command),
		'Remote Mac handshake'
	).split(/\r?\n/u);
	const [operatingSystem, home, bunPath, xcodeVersion] = lines;
	if (operatingSystem !== 'Darwin')
		throw new Error('The SSH target is not a Mac.');
	if (!home?.startsWith('/') || !bunPath?.startsWith('/'))
		throw new Error(
			'The remote Mac must have Bun installed and available to SSH.'
		);
	if (!xcodeVersion?.startsWith('Xcode '))
		throw new Error(
			'The remote Mac must have full Xcode installed and selected.'
		);

	return { bunPath, home, os: operatingSystem, xcodeVersion };
};
export const listAbsoluteRemoteMacProfiles = async (profilePath?: string) => {
	const store = await loadStore(profilePath);

	return {
		defaultProfile: store.defaultProfile,
		profiles: Object.values(store.profiles).sort((left, right) =>
			left.name.localeCompare(right.name)
		)
	};
};
export const pairAbsoluteRemoteMac = async (options: {
	destination: string;
	name: string;
	port?: number;
	profilePath?: string;
	transport?: Pick<AbsoluteRemoteMacTransport, 'capture'>;
	workspaceRoot?: string;
}) => {
	const name = validateAbsoluteRemoteMacProfileName(options.name);
	const destination = validateAbsoluteSshDestination(options.destination);
	const port = validatePort(options.port);
	const inspection = await inspectAbsoluteRemoteMac(destination, {
		acceptNew: true,
		port,
		transport: options.transport
	});
	const workspaceRoot = options.workspaceRoot
		? options.workspaceRoot.trim()
		: posix.join(inspection.home, '.absolutejs', 'remote-ios');
	if (
		!workspaceRoot.startsWith('/') ||
		workspaceRoot === '/' ||
		/[\r\n\0]/u.test(workspaceRoot)
	)
		throw new TypeError(
			'Remote Mac workspace must be an absolute macOS path.'
		);
	const profile: AbsoluteRemoteMacProfile = {
		bunPath: inspection.bunPath,
		createdAt: new Date().toISOString(),
		destination,
		name,
		...(port ? { port } : {}),
		workspaceRoot,
		xcodeVersion: inspection.xcodeVersion
	};
	const store = await loadStore(options.profilePath);
	store.profiles[name] = profile;
	store.defaultProfile = name;
	await saveStore(store, options.profilePath);

	return profile;
};
export const removeAbsoluteRemoteMacProfile = async (
	name: string,
	profilePath?: string
) => {
	const normalized = validateAbsoluteRemoteMacProfileName(name);
	const store = await loadStore(profilePath);
	if (!store.profiles[normalized]) return false;
	delete store.profiles[normalized];
	if (store.defaultProfile === normalized) {
		const [nextDefault] = Object.keys(store.profiles).sort();
		store.defaultProfile = nextDefault;
	}
	await saveStore(store, profilePath);

	return true;
};

const projectIdentity = (projectRoot: string, appId: string) =>
	createHash('sha256')
		.update(`${resolvePath(projectRoot)}\0${appId}`)
		.digest('hex')
		.slice(0, 20);

export const createAbsoluteRemoteIosDevProject = (
	config: NormalizedAbsoluteMobileConfig,
	projectRoot: string,
	profile: AbsoluteRemoteMacProfile
): AbsoluteRemoteIosDevProject => ({
	cap: join(resolvePath(projectRoot), 'node_modules', '.bin', 'cap'),
	config,
	nativeDirectory: join(config.nativeProjectDirectory, 'ios'),
	profile,
	projectRoot: resolvePath(projectRoot),
	remote: true,
	remoteProjectRoot: posix.join(
		profile.workspaceRoot,
		'projects',
		projectIdentity(projectRoot, config.appId),
		'current'
	),
	xcodebuild: 'remote:xcodebuild',
	xcrun: 'remote:xcrun'
});
export const installAbsoluteRemoteMacAgent = async (
	project: AbsoluteRemoteIosDevProject
) => {
	const artifact = await materializeAbsoluteRemoteMacAgent(
		project.projectRoot
	);
	const directory = posix.join(
		project.profile.workspaceRoot,
		'agents',
		`protocol-${ABSOLUTE_REMOTE_MAC_PROTOCOL_VERSION}`,
		artifact.sha256
	);
	const remotePath = posix.join(directory, 'agent.js');
	const verifyScript =
		`test -f ${shellQuote(remotePath)} && ` +
		`test "$(shasum -a 256 ${shellQuote(remotePath)} | awk '{print $1}')" = ${shellQuote(artifact.sha256)}`;
	const verified = await defaultTransport.capture([
		...absoluteRemoteMacSshBase(project.profile),
		'/bin/sh -lc',
		shellQuote(verifyScript)
	]);
	if (verified.exitCode === 0)
		return { ...artifact, remotePath, uploaded: false };
	const temporary = posix.join(directory, `.agent-${randomUUID()}.tmp`);
	const installScript = [
		'set -eu',
		'umask 077',
		`mkdir -p ${shellQuote(directory)}`,
		`cat > ${shellQuote(temporary)}`,
		`test "$(shasum -a 256 ${shellQuote(temporary)} | awk '{print $1}')" = ${shellQuote(artifact.sha256)}`,
		`chmod 600 ${shellQuote(temporary)}`,
		`mv ${shellQuote(temporary)} ${shellQuote(remotePath)}`
	].join('; ');
	const upload = Bun.spawn(
		[
			...absoluteRemoteMacSshBase(project.profile),
			'/bin/sh -lc',
			shellQuote(installScript)
		],
		{
			stderr: 'pipe',
			stdin: Bun.file(artifact.path),
			stdout: 'pipe'
		}
	);
	const [exitCode, stderr] = await Promise.all([
		upload.exited,
		new Response(upload.stderr).text()
	]);
	if (exitCode !== 0)
		throw new Error(
			`Remote Mac agent installation failed: ${stderr.trim() || `status ${exitCode}`}`
		);

	return { ...artifact, remotePath, uploaded: true };
};
export const materializeAbsoluteRemoteMacAgent = async (
	projectRoot: string
) => {
	const shippedCandidates = [
		join(import.meta.dir, 'remoteMacAgentEntry.js'),
		join(import.meta.dir, '..', 'mobile', 'remoteMacAgentEntry.js')
	];
	let path: string | undefined;
	for (const candidate of shippedCandidates) {
		if (await Bun.file(candidate).exists()) {
			path = candidate;
			break;
		}
	}
	if (!path) {
		const sourceCandidates = [
			join(import.meta.dir, 'remoteMacAgentEntry.ts'),
			join(
				import.meta.dir,
				'..',
				'..',
				'src',
				'mobile',
				'remoteMacAgentEntry.ts'
			)
		];
		const source = await sourceCandidates.reduce<
			Promise<string | undefined>
		>(
			async (found, candidate) =>
				(await found) ??
				((await Bun.file(candidate).exists()) ? candidate : undefined),
			Promise.resolve(undefined)
		);
		if (!source)
			throw new Error(
				'The AbsoluteJS installation does not contain its remote Mac agent artifact.'
			);
		const outdir = join(
			resolvePath(projectRoot),
			'.absolutejs',
			'mobile',
			'remote-agent'
		);
		await mkdir(outdir, { recursive: true });
		const result = await Bun.build({
			entrypoints: [source],
			minify: true,
			outdir,
			target: 'bun'
		});
		if (!result.success)
			throw new AggregateError(
				result.logs,
				'Failed to build the AbsoluteJS remote Mac agent.'
			);
		path = join(outdir, 'remoteMacAgentEntry.js');
	}
	const bytes = await Bun.file(path).arrayBuffer();
	const sha256 = createHash('sha256')
		.update(new Uint8Array(bytes))
		.digest('hex');

	return { bytes: bytes.byteLength, path, sha256 };
};

const portableRelativePath = (root: string, path: string) =>
	relative(root, path).split(sep).join(posix.sep);

const portableMobileConfig = (
	project: AbsoluteRemoteIosDevProject
): MobileConfig => ({
	appId: project.config.appId,
	appName: project.config.appName,
	bundleDirectory: portableRelativePath(
		project.projectRoot,
		project.config.bundleDirectory
	),
	...(project.config.deepLinkScheme ||
	project.config.deepLinkHosts.length > 1 ||
	project.config.appleAppIdPrefix
		? {
				deepLinks: {
					...(project.config.deepLinkScheme
						? { scheme: project.config.deepLinkScheme }
						: {}),
					hosts: project.config.deepLinkHosts,
					...(project.config.appleAppIdPrefix
						? {
								apple: {
									appIdPrefix: project.config.appleAppIdPrefix
								}
							}
						: {})
				}
			}
		: {}),
	entry: project.config.entry,
	...(project.config.iosVersion
		? { ios: { version: project.config.iosVersion } }
		: {}),
	nativeProject: {
		directory: portableRelativePath(
			project.projectRoot,
			project.config.nativeProjectDirectory
		),
		mode: 'source'
	},
	platforms: ['ios'],
	server: { productionOrigin: project.config.productionOrigin }
});

export const absoluteRemoteProjectSyncCommands = (
	project: AbsoluteRemoteIosDevProject
) => {
	const current = project.remoteProjectRoot;
	const parent = posix.dirname(current);
	const staging = posix.join(parent, `.incoming-${randomUUID()}`);
	const previous = posix.join(parent, '.previous');
	const script = [
		'set -eu',
		`mkdir -p ${shellQuote(staging)}`,
		`tar -xf - -C ${shellQuote(staging)}`,
		`if [ -d ${shellQuote(posix.join(current, 'node_modules'))} ]; then mv ${shellQuote(posix.join(current, 'node_modules'))} ${shellQuote(posix.join(staging, 'node_modules'))}; fi`,
		`if [ -d ${shellQuote(posix.join(current, '.absolutejs'))} ]; then mv ${shellQuote(posix.join(current, '.absolutejs'))} ${shellQuote(posix.join(staging, '.absolutejs'))}; fi`,
		`rm -rf ${shellQuote(previous)}`,
		`if [ -d ${shellQuote(current)} ]; then mv ${shellQuote(current)} ${shellQuote(previous)}; fi`,
		`mv ${shellQuote(staging)} ${shellQuote(current)}`,
		`rm -rf ${shellQuote(previous)}`
	].join('; ');

	return {
		remote: [
			...absoluteRemoteMacSshBase(project.profile),
			'/bin/sh -lc',
			shellQuote(script)
		],
		tar: [
			'tar',
			'--exclude=.git',
			'--exclude=node_modules',
			'--exclude=build',
			'--exclude=.absolutejs',
			'-cf',
			'-',
			'-C',
			project.projectRoot,
			'.'
		]
	};
};

export const syncAbsoluteRemoteMacProject = async (
	project: AbsoluteRemoteIosDevProject
) => {
	const commands = absoluteRemoteProjectSyncCommands(project);
	const archive = Bun.spawn(commands.tar, {
		stderr: 'pipe',
		stdout: 'pipe'
	});
	const upload = Bun.spawn(commands.remote, {
		stderr: 'pipe',
		stdin: archive.stdout,
		stdout: 'pipe'
	});
	const [archiveExit, uploadExit, archiveError, uploadError] =
		await Promise.all([
			archive.exited,
			upload.exited,
			new Response(archive.stderr).text(),
			new Response(upload.stderr).text()
		]);
	if (archiveExit !== 0 || uploadExit !== 0)
		throw new Error(
			`Remote Mac project synchronization failed: ${(archiveError || uploadError).trim()}`
		);
	const install = await defaultTransport.capture([
		...absoluteRemoteMacSshBase(project.profile),
		'/bin/sh -lc',
		shellQuote(
			`cd ${shellQuote(project.remoteProjectRoot)} && ${shellQuote(project.profile.bunPath)} install --frozen-lockfile`
		)
	]);
	requireRemoteSuccess(install, 'Remote Mac dependency installation');
};

const consumeLines = async (
	stream: ReadableStream<Uint8Array>,
	onLine: (line: string) => void
) => {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffered = '';
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffered += decoder.decode(value, { stream: true });
			const lines = buffered.split(/\r?\n/u);
			buffered = lines.pop() ?? '';
			lines.forEach(onLine);
		}
		buffered += decoder.decode();
		if (buffered) onLine(buffered);
	} finally {
		reader.releaseLock();
	}
};

export const startAbsoluteRemoteIosDevSession = async (
	options: AbsoluteRemoteIosOptions
) => {
	const startedAt = performance.now();
	const transport = options.transport ?? defaultTransport;
	const installAgent = options.installAgent ?? installAbsoluteRemoteMacAgent;
	const syncProject = options.syncProject ?? syncAbsoluteRemoteMacProject;
	const agentStartedAt = performance.now();
	const agent = await installAgent(options.project);
	const agentDuration = performance.now() - agentStartedAt;
	const syncStartedAt = performance.now();
	await syncProject(options.project);
	const syncDuration = performance.now() - syncStartedAt;
	const encodedConfig = Buffer.from(
		JSON.stringify(portableMobileConfig(options.project))
	).toString('base64url');
	const remoteCommand = [
		`cd ${shellQuote(options.project.remoteProjectRoot)}`,
		'&&',
		'exec',
		shellQuote(options.project.profile.bunPath),
		shellQuote(agent.remotePath),
		'--port',
		String(options.port),
		'--mobile-config',
		shellQuote(encodedConfig),
		...(options.https ? ['--https'] : [])
	].join(' ');
	const command = [
		...absoluteRemoteMacSshBase(options.project.profile),
		'-o',
		'ExitOnForwardFailure=yes',
		'-R',
		`${options.port}:127.0.0.1:${options.port}`,
		'/bin/sh -lc',
		shellQuote(remoteCommand)
	];
	const connectStartedAt = performance.now();
	const process = transport.spawn(command, { signal: options.signal });
	let state: AbsoluteIosDevState = 'syncing';
	let ready: Extract<RemoteEvent, { type: 'ready' }> | undefined;
	let fatal: Error | undefined;
	const pending = new Map<
		string,
		{ reject: (error: Error) => void; resolve: (value: unknown) => void }
	>();
	let resolveReady!: () => void;
	let rejectReady!: (error: Error) => void;
	const readyPromise = new Promise<void>((resolve, reject) => {
		resolveReady = resolve;
		rejectReady = reject;
	});
	const handleEvent = (event: RemoteEvent) => {
		if (event.v !== ABSOLUTE_REMOTE_MAC_PROTOCOL_VERSION) {
			rejectReady(new Error('Remote Mac protocol version mismatch.'));

			return;
		}
		if (event.type === 'log') options.log?.(event.message);
		if (event.type === 'native-log') options.nativeLog?.(event.entry);
		if (event.type === 'state') {
			({ state } = event);
			options.onStateChange?.(state);
		}
		if (event.type === 'timing') options.onPhaseTiming?.(event);
		if (event.type === 'ready') {
			ready = event;
			resolveReady();
		}
		if (event.type === 'fatal') {
			fatal = new Error(event.error);
			rejectReady(fatal);
		}
		if (event.type === 'response') {
			const request = pending.get(event.id);
			if (!request) return;
			pending.delete(event.id);
			if (event.ok) request.resolve(event.result);
			else
				request.reject(
					new Error(event.error ?? 'Remote command failed.')
				);
		}
	};
	const stdoutDone = consumeLines(process.stdout, (line) => {
		if (!line.startsWith(ABSOLUTE_REMOTE_MAC_EVENT_PREFIX)) return;
		try {
			handleEvent(
				JSON.parse(
					line.slice(ABSOLUTE_REMOTE_MAC_EVENT_PREFIX.length)
				) as RemoteEvent
			);
		} catch {
			options.log?.(`Remote Mac emitted an invalid protocol event.`);
		}
	}).catch((error: unknown) => {
		fatal =
			error instanceof Error
				? error
				: new Error('Failed to read the remote Mac protocol stream.');
		rejectReady(fatal);
	});
	const stderrDone = consumeLines(process.stderr, (line) =>
		options.log?.(`[remote] ${line}`)
	).catch((error: unknown) =>
		options.log?.(
			`[remote] ${error instanceof Error ? error.message : 'Failed to read SSH stderr.'}`
		)
	);
	void process.exited.then(async (exitCode) => {
		await Promise.all([stdoutDone, stderrDone]);
		const error =
			fatal ??
			new Error(`Remote Mac connection closed with status ${exitCode}.`);
		if (!ready) rejectReady(error);
		pending.forEach(({ reject }) => reject(error));
		pending.clear();

		return undefined;
	});
	await readyPromise;
	if (!ready) throw fatal ?? new Error('Remote Mac did not become ready.');
	const totalDuration = performance.now() - startedAt;
	let currentReady: Extract<RemoteEvent, { type: 'ready' }> = {
		...ready,
		timings: {
			...ready.timings,
			'remote-agent': agentDuration,
			'remote-connect': performance.now() - connectStartedAt,
			'remote-sync': syncDuration,
			total: totalDuration
		}
	};
	options.log?.(
		`Remote Mac connected (${options.project.profile.name}); agent ${agent.uploaded ? 'uploaded' : 'cache hit'}, project synced, and iOS ready in ${totalDuration.toFixed(2)}ms.`
	);

	const request = (
		commandName: 'close' | 'rebuild' | 'relaunch' | 'screenshot'
	) => {
		const id = randomUUID();
		const response = new Promise<unknown>((resolve, reject) =>
			pending.set(id, { reject, resolve })
		);
		process.stdin.write(
			`${JSON.stringify({ command: commandName, id, v: 1 })}\n`
		);
		process.stdin.flush();

		return response;
	};
	let closed = false;
	const close = async () => {
		if (closed) return;
		closed = true;
		await request('close').catch(() => undefined);
		process.stdin.end();
		await process.exited.catch(() => undefined);
	};
	const makeSession = (): AbsoluteIosDevSession => ({
		close,
		nativeCacheHit: currentReady.nativeCacheHit,
		startedSimulator: currentReady.startedSimulator,
		timings: currentReady.timings,
		udid: currentReady.udid,
		rebuild: async () => {
			const rebuildStartedAt = performance.now();
			const rebuildSyncStartedAt = performance.now();
			await syncProject(options.project);
			const rebuildSyncDuration =
				performance.now() - rebuildSyncStartedAt;
			const result = (await request('rebuild')) as Extract<
				RemoteEvent,
				{ type: 'ready' }
			>;
			currentReady = {
				...result,
				timings: {
					...result.timings,
					'remote-sync': rebuildSyncDuration,
					total: performance.now() - rebuildStartedAt
				}
			};

			return makeSession();
		},
		relaunch: async () => {
			await request('relaunch');
		},
		screenshot: async (destination) => {
			const result = (await request('screenshot')) as { data: string };
			const target = resolvePath(
				options.project.projectRoot,
				destination
			);
			const targetRelative = relative(
				options.project.projectRoot,
				target
			);
			if (targetRelative.startsWith('..') || isAbsolute(targetRelative))
				throw new Error(
					'iOS screenshot must remain inside the project.'
				);
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, Buffer.from(result.data, 'base64'));

			return target;
		},
		get state() {
			return state;
		}
	});

	return makeSession();
};
