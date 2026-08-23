import { createHash, randomUUID } from 'node:crypto';
import {
	access,
	copyFile,
	mkdir,
	readFile,
	rename,
	rm,
	writeFile
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { NormalizedAbsoluteMobileConfig } from './config';
import {
	detectAbsoluteMobileHost,
	inspectAbsoluteMobileToolchain
} from './emulatorDoctor';
import { writeAbsoluteCapacitorConfig } from './capacitorProject';
import { fingerprintAbsoluteIosNativeProject } from './iosRelease';
import { getDurationString } from '../utils/getDurationString';

export const ABSOLUTE_IOS_SIMULATOR_NAME = 'AbsoluteJS iPhone';

const BOOT_TIMEOUT_MS = 180_000;
const BOOT_POLL_MS = 1_000;
const DEV_JOURNAL_FORMAT = 1;
const NATIVE_CACHE_FORMAT = 1;

export type AbsoluteIosCommandOptions = {
	cwd?: string;
	env?: Record<string, string | undefined>;
	signal?: AbortSignal;
};

export type AbsoluteIosCommandResult = {
	exitCode: number;
	stderr: string;
	stdout: string;
};

export type AbsoluteIosDevState =
	| 'booting'
	| 'building'
	| 'checking-native'
	| 'closed'
	| 'closing'
	| 'configuring'
	| 'connecting'
	| 'failed'
	| 'installing'
	| 'launching'
	| 'ready'
	| 'streaming-logs'
	| 'syncing';

export type AbsoluteIosNativeLogEntry = {
	level: 'debug' | 'error' | 'fault' | 'info' | 'notice';
	message: string;
	tag: string;
};

type AbsoluteIosLogStream = { close: () => Promise<void> };

export type AbsoluteIosDevProject = {
	cap: string;
	config: NormalizedAbsoluteMobileConfig;
	nativeDirectory: string;
	projectRoot: string;
	xcodebuild: string;
	xcrun: string;
};

export type AbsoluteIosDevSession = {
	close: () => Promise<void>;
	nativeCacheHit: boolean;
	rebuild: () => Promise<AbsoluteIosDevSession>;
	relaunch: () => Promise<void>;
	screenshot: (destination: string) => Promise<string>;
	startedSimulator: boolean;
	state: AbsoluteIosDevState;
	timings: Record<string, number>;
	udid: string;
};

export type AbsoluteIosDevPhaseTiming = {
	durationMs: number;
	phase: AbsoluteIosDevState;
	totalMs: number;
};

export type PrepareAbsoluteIosDevOptions = {
	createNativeProject: boolean;
	projectRoot: string;
	run?: (
		command: string[],
		options?: AbsoluteIosCommandOptions
	) => Promise<number>;
};

export type StartAbsoluteIosDevOptions = {
	capture?: (
		command: string[],
		options?: AbsoluteIosCommandOptions
	) => AbsoluteIosCommandResult;
	https?: boolean;
	log?: (message: string) => void;
	nativeLog?: (entry: AbsoluteIosNativeLogEntry) => void;
	onPhaseTiming?: (timing: AbsoluteIosDevPhaseTiming) => void;
	onStateChange?: (state: AbsoluteIosDevState) => void;
	port: number;
	project: AbsoluteIosDevProject;
	run?: (
		command: string[],
		options?: AbsoluteIosCommandOptions
	) => Promise<number>;
	signal?: AbortSignal;
	sleep?: (milliseconds: number) => Promise<void>;
	spawn?: (command: string[], options?: AbsoluteIosCommandOptions) => void;
	startNativeLogs?: (
		command: string[],
		options: AbsoluteIosCommandOptions,
		onLine: (line: string) => void
	) => AbsoluteIosLogStream;
};

type IosRuntime = {
	identifier: string;
	isAvailable: boolean;
	name: string;
	version: string;
};

type IosDeviceType = { identifier: string; name: string };

type IosDevJournal = {
	configBackupPath: string;
	format: number;
	infoBackupPath: string;
	infoPath: string;
	nativeConfigPath: string;
};

type IosNativeCache = {
	appId: string;
	fingerprint: string;
	format: number;
	installations: Record<string, string>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const pathExists = async (path: string) => {
	try {
		await access(path);

		return true;
	} catch {
		return false;
	}
};

const throwIfAborted = (signal?: AbortSignal) => signal?.throwIfAborted();

const defaultCapture = (
	command: string[],
	options: AbsoluteIosCommandOptions = {}
) => {
	try {
		const result = Bun.spawnSync(command, {
			cwd: options.cwd,
			env: options.env,
			stderr: 'pipe',
			stdin: 'ignore',
			stdout: 'pipe'
		});

		return {
			exitCode: result.exitCode,
			stderr: result.stderr.toString(),
			stdout: result.stdout.toString()
		};
	} catch (error) {
		return {
			exitCode: 1,
			stderr: error instanceof Error ? error.message : String(error),
			stdout: ''
		};
	}
};

const defaultRun = async (
	command: string[],
	options: AbsoluteIosCommandOptions = {}
) => {
	const process = Bun.spawn(command, {
		cwd: options.cwd,
		env: options.env,
		signal: options.signal,
		stderr: 'inherit',
		stdin: 'inherit',
		stdout: 'inherit'
	});

	return process.exited;
};

const defaultSpawn = (
	command: string[],
	options: AbsoluteIosCommandOptions = {}
) => {
	Bun.spawn(command, {
		cwd: options.cwd,
		env: options.env,
		signal: options.signal,
		stderr: 'ignore',
		stdin: 'ignore',
		stdout: 'ignore'
	});
};

const consumeLines = async (
	stream: ReadableStream<Uint8Array>,
	onLine: (line: string) => void
) => {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffered = '';
	const pump = async (): Promise<void> => {
		const { done, value } = await reader.read();
		if (done) return;
		buffered += decoder.decode(value, { stream: true });
		const lines = buffered.split(/\r?\n/u);
		buffered = lines.pop() ?? '';
		lines.forEach(onLine);

		await pump();
	};
	try {
		await pump();
		buffered += decoder.decode();
		if (buffered) onLine(buffered);
	} finally {
		reader.releaseLock();
	}
};

const defaultStartNativeLogs = (
	command: string[],
	options: AbsoluteIosCommandOptions,
	onLine: (line: string) => void
): AbsoluteIosLogStream => {
	const process = Bun.spawn(command, {
		cwd: options.cwd,
		env: options.env,
		signal: options.signal,
		stderr: 'pipe',
		stdin: 'ignore',
		stdout: 'pipe'
	});
	void consumeLines(process.stdout, onLine);
	void consumeLines(process.stderr, onLine);

	return {
		close: async () => {
			try {
				process.kill();
			} catch {
				/* already closed */
			}
			await process.exited.catch(() => undefined);
		}
	};
};

const requireSuccess = async (
	command: string[],
	label: string,
	run: NonNullable<StartAbsoluteIosDevOptions['run']>,
	options?: AbsoluteIosCommandOptions
) => {
	const exitCode = await run(command, options);
	if (exitCode !== 0)
		throw new Error(`${label} failed with status ${exitCode}.`);
};

const requireCapturedSuccess = (
	result: AbsoluteIosCommandResult,
	label: string
) => {
	if (result.exitCode !== 0) {
		throw new Error(
			`${label} failed: ${result.stderr.trim() || result.stdout.trim() || `status ${result.exitCode}`}`
		);
	}

	return result.stdout.trim();
};

const parseJson = (source: string, label: string) => {
	try {
		const parsed: unknown = JSON.parse(source);
		if (isRecord(parsed)) return parsed;
	} catch {
		/* normalized below */
	}
	throw new Error(`Invalid ${label} JSON from simctl.`);
};

export const parseIosDeviceTypes = (source: string) => {
	const parsed = parseJson(source, 'device type');
	const types = parsed.devicetypes;
	if (!Array.isArray(types)) return [];

	return types.flatMap((type) => {
		if (!isRecord(type)) return [];
		const { identifier } = type;
		const { name } = type;

		return typeof identifier === 'string' && typeof name === 'string'
			? [{ identifier, name }]
			: [];
	});
};
export const parseIosRuntimes = (source: string) => {
	const parsed = parseJson(source, 'runtime');
	const { runtimes } = parsed;
	if (!Array.isArray(runtimes)) return [];

	return runtimes.flatMap((runtime) => {
		if (!isRecord(runtime)) return [];
		const { identifier } = runtime;
		const { name } = runtime;
		const { version } = runtime;
		if (
			typeof identifier !== 'string' ||
			typeof name !== 'string' ||
			typeof version !== 'string'
		)
			return [];

		return [
			{
				identifier,
				isAvailable: runtime.isAvailable !== false,
				name,
				version
			}
		];
	});
};
export const parseIosSimulators = (source: string) => {
	const parsed = parseJson(source, 'device');
	const { devices } = parsed;
	if (!isRecord(devices)) return [];

	return Object.entries(devices).flatMap(([runtime, values]) => {
		if (!Array.isArray(values)) return [];

		return values.flatMap((device) => {
			if (!isRecord(device)) return [];
			const { name } = device;
			const { state } = device;
			const { udid } = device;
			if (
				typeof name !== 'string' ||
				typeof state !== 'string' ||
				typeof udid !== 'string'
			)
				return [];

			return [
				{
					isAvailable: device.isAvailable !== false,
					name,
					runtime,
					state,
					udid
				}
			];
		});
	});
};

const versionParts = (version: string) =>
	version.split('.').map((part) => Number(part));

const compareVersions = (left: string, right: string) => {
	const leftParts = versionParts(left);
	const rightParts = versionParts(right);
	const length = Math.max(leftParts.length, rightParts.length);
	for (let index = 0; index < length; index++) {
		const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
		if (difference !== 0) return difference;
	}

	return 0;
};

const latestIosRuntime = (runtimes: IosRuntime[]) =>
	runtimes
		.filter(
			(runtime) =>
				runtime.isAvailable &&
				runtime.identifier.includes('SimRuntime.iOS-')
		)
		.sort((left, right) => compareVersions(right.version, left.version))[0];

const iphoneGeneration = (name: string) =>
	Number(/iPhone\s+(\d+)/u.exec(name)?.[1] ?? 0);

const preferredIphoneType = (types: IosDeviceType[]) =>
	types
		.filter((type) => type.name.startsWith('iPhone'))
		.sort((left, right) => {
			const generation =
				iphoneGeneration(right.name) - iphoneGeneration(left.name);
			if (generation !== 0) return generation;
			const rightPro = right.name.includes('Pro') ? 1 : 0;
			const leftPro = left.name.includes('Pro') ? 1 : 0;

			return rightPro - leftPro;
		})[0];

const journalPaths = (projectRoot: string) => {
	const root = join(projectRoot, '.absolutejs', 'mobile', 'ios-dev-session');

	return {
		configBackup: join(root, 'capacitor-config.backup'),
		infoBackup: join(root, 'Info.plist.backup'),
		journal: join(root, 'journal.json'),
		root
	};
};

const nativeCachePath = (projectRoot: string) =>
	join(projectRoot, '.absolutejs', 'mobile', 'ios-native-cache.json');

const isInside = (root: string, path: string) => {
	const value = relative(resolve(root), resolve(path));

	return (
		value === '' ||
		(!value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value))
	);
};

const parseJournal = (value: unknown): IosDevJournal | null => {
	if (!isRecord(value) || value.format !== DEV_JOURNAL_FORMAT) return null;
	const { configBackupPath } = value;
	const { infoBackupPath } = value;
	const { infoPath } = value;
	const { nativeConfigPath } = value;
	if (
		typeof configBackupPath !== 'string' ||
		typeof infoBackupPath !== 'string' ||
		typeof infoPath !== 'string' ||
		typeof nativeConfigPath !== 'string'
	)
		return null;

	return {
		configBackupPath,
		format: DEV_JOURNAL_FORMAT,
		infoBackupPath,
		infoPath,
		nativeConfigPath
	};
};

export const repairAbsoluteIosDevSession = async (projectRoot: string) => {
	const paths = journalPaths(projectRoot);
	if (!(await pathExists(paths.journal))) {
		await rm(paths.root, { force: true, recursive: true });

		return false;
	}
	const journal = await readFile(paths.journal, 'utf8')
		.then((source) => parseJournal(JSON.parse(source)))
		.catch(() => null);
	if (
		!journal ||
		!isInside(projectRoot, journal.nativeConfigPath) ||
		!isInside(projectRoot, journal.infoPath) ||
		!isInside(paths.root, journal.configBackupPath) ||
		!isInside(paths.root, journal.infoBackupPath)
	) {
		throw new Error(
			`Refusing unsafe or invalid iOS dev journal at ${paths.journal}.`
		);
	}
	if (await pathExists(journal.configBackupPath))
		await copyFile(journal.configBackupPath, journal.nativeConfigPath);
	if (await pathExists(journal.infoBackupPath))
		await copyFile(journal.infoBackupPath, journal.infoPath);
	await rm(paths.root, { force: true, recursive: true });

	return true;
};

const iosDevelopmentInfoPlist = (source: string, cleartext: boolean) => {
	if (!cleartext) return source;
	const arbitraryLoads =
		/(<key>NSAllowsArbitraryLoads<\/key>\s*)<false\s*\/>/u;
	if (arbitraryLoads.test(source))
		return source.replace(arbitraryLoads, '$1<true/>');
	if (/<key>NSAllowsArbitraryLoads<\/key>\s*<true\s*\/>/u.test(source))
		return source;
	const transport = /(<key>NSAppTransportSecurity<\/key>\s*<dict>)/u;
	if (transport.test(source))
		return source.replace(
			transport,
			'$1\n\t\t<key>NSAllowsArbitraryLoads</key>\n\t\t<true/>'
		);

	return source.replace(
		/<dict>/u,
		'<dict>\n\t<key>NSAppTransportSecurity</key>\n\t<dict>\n\t\t<key>NSAllowsArbitraryLoads</key>\n\t\t<true/>\n\t</dict>'
	);
};

const writeDevProjection = async (
	project: AbsoluteIosDevProject,
	port: number,
	https: boolean
) => {
	const paths = journalPaths(project.projectRoot);
	await repairAbsoluteIosDevSession(project.projectRoot);
	const nativeConfigPath = join(
		project.nativeDirectory,
		'App',
		'App',
		'capacitor.config.json'
	);
	const infoPath = join(project.nativeDirectory, 'App', 'App', 'Info.plist');
	const [configSource, infoSource] = await Promise.all([
		readFile(nativeConfigPath, 'utf8'),
		readFile(infoPath, 'utf8')
	]);
	const parsed: unknown = JSON.parse(configSource);
	if (!isRecord(parsed))
		throw new Error(
			`Invalid Capacitor native config at ${nativeConfigPath}.`
		);
	await mkdir(paths.root, { recursive: true });
	await Promise.all([
		writeFile(paths.configBackup, configSource, { flag: 'wx' }),
		writeFile(paths.infoBackup, infoSource, { flag: 'wx' })
	]);
	const journal: IosDevJournal = {
		configBackupPath: paths.configBackup,
		format: DEV_JOURNAL_FORMAT,
		infoBackupPath: paths.infoBackup,
		infoPath,
		nativeConfigPath
	};
	await writeFile(paths.journal, `${JSON.stringify(journal, null, '\t')}\n`, {
		flag: 'wx'
	});
	const developmentUrl = new URL(
		`${https ? 'https' : 'http'}://localhost:${port}${project.config.entry}`
	);
	developmentUrl.searchParams.set('__absolute_target', 'capacitor-ios');
	const existingServer = parsed.server;
	parsed.server = {
		...(isRecord(existingServer) ? existingServer : {}),
		cleartext: !https,
		url: developmentUrl.href
	};
	await Promise.all([
		writeFile(nativeConfigPath, `${JSON.stringify(parsed, null, '\t')}\n`),
		writeFile(infoPath, iosDevelopmentInfoPlist(infoSource, !https))
	]);
};

const parseNativeCache = (value: unknown): IosNativeCache | null => {
	if (!isRecord(value)) return null;
	const { appId, fingerprint, format, installations } = value;
	if (
		format !== NATIVE_CACHE_FORMAT ||
		typeof appId !== 'string' ||
		typeof fingerprint !== 'string' ||
		!isRecord(installations) ||
		!Object.values(installations).every(
			(identity) => typeof identity === 'string'
		)
	)
		return null;

	return {
		appId,
		fingerprint,
		format,
		installations: Object.fromEntries(
			Object.entries(installations).map(([udid, identity]) => [
				udid,
				String(identity)
			])
		)
	};
};

const readNativeCache = (projectRoot: string) =>
	readFile(nativeCachePath(projectRoot), 'utf8')
		.then((source) => parseNativeCache(JSON.parse(source)))
		.catch(() => null);

const writeNativeCache = async (projectRoot: string, cache: IosNativeCache) => {
	const destination = nativeCachePath(projectRoot);
	const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
	await mkdir(dirname(destination), { recursive: true });
	try {
		await writeFile(temporary, `${JSON.stringify(cache, null, '\t')}\n`, {
			flag: 'wx'
		});
		await rename(temporary, destination);
	} finally {
		await rm(temporary, { force: true }).catch(() => undefined);
	}
};

export const fingerprintAbsoluteIosDevProject = async (
	project: Pick<AbsoluteIosDevProject, 'nativeDirectory'>
) => fingerprintAbsoluteIosNativeProject(project.nativeDirectory);

const simulatorInventory = (
	xcrun: string,
	capture: NonNullable<StartAbsoluteIosDevOptions['capture']>
) => {
	const result = capture([
		xcrun,
		'simctl',
		'list',
		'devices',
		'available',
		'-j'
	]);

	return parseIosSimulators(
		requireCapturedSuccess(result, 'iOS simulator discovery')
	);
};

const ensureManagedSimulator = async (
	project: AbsoluteIosDevProject,
	capture: NonNullable<StartAbsoluteIosDevOptions['capture']>
) => {
	const runtimes = parseIosRuntimes(
		requireCapturedSuccess(
			capture([project.xcrun, 'simctl', 'list', 'runtimes', '-j']),
			'iOS runtime discovery'
		)
	);
	const runtime = latestIosRuntime(runtimes);
	if (!runtime)
		throw new Error(
			'No available iOS Simulator runtime. Run absolute mobile doctor ios --fix.'
		);
	const [existing] = simulatorInventory(project.xcrun, capture)
		.filter(
			(device) =>
				device.isAvailable &&
				device.name === ABSOLUTE_IOS_SIMULATOR_NAME &&
				device.runtime === runtime.identifier
		)
		.sort(
			(left, right) =>
				Number(right.state === 'Booted') -
				Number(left.state === 'Booted')
		);
	if (existing) return { created: false, device: existing };
	const types = parseIosDeviceTypes(
		requireCapturedSuccess(
			capture([project.xcrun, 'simctl', 'list', 'devicetypes', '-j']),
			'iOS device-type discovery'
		)
	);
	const type = preferredIphoneType(types);
	if (!type)
		throw new Error('Xcode did not report an iPhone simulator type.');
	const [udid] = requireCapturedSuccess(
		capture([
			project.xcrun,
			'simctl',
			'create',
			ABSOLUTE_IOS_SIMULATOR_NAME,
			type.identifier,
			runtime.identifier
		]),
		'iOS simulator creation'
	).split(/\s/u);
	if (!udid)
		throw new Error('simctl did not return the created simulator UDID.');

	return {
		created: true,
		device: {
			isAvailable: true,
			name: ABSOLUTE_IOS_SIMULATOR_NAME,
			runtime: runtime.identifier,
			state: 'Shutdown',
			udid
		}
	};
};

const waitForBootedSimulator = async (
	project: AbsoluteIosDevProject,
	udid: string,
	capture: NonNullable<StartAbsoluteIosDevOptions['capture']>,
	sleep: NonNullable<StartAbsoluteIosDevOptions['sleep']>,
	signal?: AbortSignal
) => {
	const deadline = Date.now() + BOOT_TIMEOUT_MS;
	const poll = async (): Promise<void> => {
		throwIfAborted(signal);
		const device = simulatorInventory(project.xcrun, capture).find(
			(candidate) => candidate.udid === udid
		);
		if (device?.state === 'Booted') return;
		if (Date.now() > deadline)
			throw new Error(
				`iOS simulator ${udid} did not finish booting within ${BOOT_TIMEOUT_MS / 1_000}s.`
			);
		await sleep(BOOT_POLL_MS);

		await poll();
	};

	return poll();
};

const bootSimulator = (
	project: AbsoluteIosDevProject,
	device: ReturnType<typeof parseIosSimulators>[number],
	capture: NonNullable<StartAbsoluteIosDevOptions['capture']>
) => {
	if (device.state === 'Booted') return;
	requireCapturedSuccess(
		capture([project.xcrun, 'simctl', 'boot', device.udid]),
		'iOS simulator boot'
	);
};

const installedAppIdentity = (
	project: AbsoluteIosDevProject,
	udid: string,
	capture: NonNullable<StartAbsoluteIosDevOptions['capture']>
) => {
	const result = capture([
		project.xcrun,
		'simctl',
		'get_app_container',
		udid,
		project.config.appId,
		'app'
	]);

	return result.exitCode === 0 && result.stdout.trim()
		? result.stdout.trim()
		: undefined;
};

const buildIosDebugApp = async (
	project: AbsoluteIosDevProject,
	udid: string,
	fingerprint: string,
	run: NonNullable<StartAbsoluteIosDevOptions['run']>,
	signal?: AbortSignal
) => {
	const derivedDataPath = join(
		project.projectRoot,
		'.absolutejs',
		'mobile',
		'ios-derived-data',
		createHash('sha256')
			.update(project.config.appId)
			.digest('hex')
			.slice(0, 16)
	);
	await mkdir(derivedDataPath, { recursive: true });
	await requireSuccess(
		[
			project.xcodebuild,
			'-workspace',
			join(project.nativeDirectory, 'App', 'App.xcworkspace'),
			'-scheme',
			'App',
			'-configuration',
			'Debug',
			'-destination',
			`platform=iOS Simulator,id=${udid}`,
			'-derivedDataPath',
			derivedDataPath,
			'build'
		],
		'iOS simulator build',
		run,
		{ cwd: project.nativeDirectory, signal }
	);
	const appPath = join(
		derivedDataPath,
		'Build',
		'Products',
		'Debug-iphonesimulator',
		'App.app'
	);
	if (!(await pathExists(appPath)))
		throw new Error(
			`Xcode did not produce the simulator app at ${appPath}.`
		);

	return appPath;
};

const ensureIosDebugApp = async (options: {
	cache: IosNativeCache | null;
	capture: NonNullable<StartAbsoluteIosDevOptions['capture']>;
	fingerprint: string;
	log: NonNullable<StartAbsoluteIosDevOptions['log']>;
	project: AbsoluteIosDevProject;
	run: NonNullable<StartAbsoluteIosDevOptions['run']>;
	signal?: AbortSignal;
	transition: (state: AbsoluteIosDevState) => void;
	udid: string;
}) => {
	const installed = installedAppIdentity(
		options.project,
		options.udid,
		options.capture
	);
	const cacheHit =
		options.cache?.appId === options.project.config.appId &&
		options.cache.fingerprint === options.fingerprint &&
		installed !== undefined &&
		options.cache.installations[options.udid] === installed;
	if (cacheHit) {
		options.log(
			`iOS native app is unchanged on ${options.udid}; skipped Xcode build and install.`
		);

		return true;
	}
	options.log(
		'iOS native inputs changed or the installed app is stale; rebuilding.'
	);
	options.transition('building');
	const appPath = await buildIosDebugApp(
		options.project,
		options.udid,
		options.fingerprint,
		options.run,
		options.signal
	);
	throwIfAborted(options.signal);
	options.transition('installing');
	await requireSuccess(
		[options.project.xcrun, 'simctl', 'install', options.udid, appPath],
		'iOS simulator app installation',
		options.run,
		{ signal: options.signal }
	);
	const updated = installedAppIdentity(
		options.project,
		options.udid,
		options.capture
	);
	if (updated) {
		await writeNativeCache(options.project.projectRoot, {
			appId: options.project.config.appId,
			fingerprint: options.fingerprint,
			format: NATIVE_CACHE_FORMAT,
			installations: { [options.udid]: updated }
		}).catch((error) =>
			options.log(
				`iOS native cache could not be saved: ${error instanceof Error ? error.message : String(error)}`
			)
		);
	}

	return false;
};

const SECRET_VALUE =
	/((?:authorization|cookie|password|secret|token|oauth[_-]?code)\s*[:=]\s*)([^\s,;]+)/giu;
const BEARER_VALUE = new RegExp(
	String.raw`\bBearer\s+[A-Za-z0-9._~+/-]+=*`,
	'giu'
);
const JWT_VALUE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu;
const IOS_LOG_PATTERN = new RegExp(
	String.raw`\s(Debug|Info|Notice|Error|Fault)\s+.*?\[[^\]]+\]\s+\[([^\]]+)\]\s*(.*)$`,
	'iu'
);

export const parseAbsoluteIosLogLine = (
	line: string
): AbsoluteIosNativeLogEntry | null => {
	const sanitized = redactAbsoluteIosLog(line).trim();
	if (!sanitized) return null;
	const match = IOS_LOG_PATTERN.exec(sanitized);
	const candidate = match?.[1]?.toLowerCase();
	const level =
		candidate === 'debug' ||
		candidate === 'error' ||
		candidate === 'fault' ||
		candidate === 'notice'
			? candidate
			: 'info';

	return {
		level,
		message: match?.[3]?.trim() || sanitized,
		tag: match?.[2]?.trim() || 'App'
	};
};
export const redactAbsoluteIosLog = (value: string) =>
	value
		.replaceAll(BEARER_VALUE, 'Bearer [REDACTED]')
		.replaceAll(JWT_VALUE, '[REDACTED_JWT]')
		.replaceAll(SECRET_VALUE, '$1[REDACTED]')
		.replaceAll(/\p{C}/gu, '');

const attachNativeLogs = (
	project: AbsoluteIosDevProject,
	udid: string,
	options: StartAbsoluteIosDevOptions
) => {
	if (!options.nativeLog) return null;
	const start = options.startNativeLogs ?? defaultStartNativeLogs;

	return start(
		[
			project.xcrun,
			'simctl',
			'spawn',
			udid,
			'log',
			'stream',
			'--style',
			'compact',
			'--level',
			'debug',
			'--predicate',
			'process == "App"'
		],
		{ signal: options.signal },
		(line) => {
			const entry = parseAbsoluteIosLogLine(line);
			if (entry) options.nativeLog?.(entry);
		}
	);
};

const IOS_TIMING_PHASES: Array<[string, string]> = [
	['syncing', 'Capacitor sync'],
	['configuring', 'dev config'],
	['fingerprinting', 'fingerprint'],
	['booting', 'simulator'],
	['connecting', 'device ready'],
	['checking-native', 'app check'],
	['building', 'Xcode'],
	['installing', 'install'],
	['launching', 'launch'],
	['streaming-logs', 'logs']
];

const timingSummary = (timings: Record<string, number>) =>
	IOS_TIMING_PHASES.map(([phase, label]) => {
		const duration = timings[phase];

		return duration === undefined
			? null
			: `${label} ${getDurationString(duration)}`;
	})
		.filter((value): value is string => value !== null)
		.join(', ');

export const prepareAbsoluteIosDevProject = async (
	config: NormalizedAbsoluteMobileConfig,
	options: PrepareAbsoluteIosDevOptions
): Promise<AbsoluteIosDevProject> => {
	if (detectAbsoluteMobileHost() !== 'macos')
		throw new Error('iOS simulation requires macOS and Xcode.');
	const projectRoot = resolve(options.projectRoot);
	const checks = await inspectAbsoluteMobileToolchain({ host: 'macos' });
	const failed = checks.filter(
		(check) =>
			check.platform === 'ios' &&
			(check.status === 'fail' || check.status === 'warn')
	);
	if (failed.length > 0)
		throw new Error(
			`iOS simulation is not ready: ${failed.map(({ label }) => label).join(', ')}.`
		);
	const xcrun = checks.find((check) => check.id === 'ios.xcrun')?.path;
	const xcodebuild = checks.find(
		(check) => check.id === 'ios.xcodebuild'
	)?.path;
	if (!xcrun || !xcodebuild)
		throw new Error('Xcode tools disappeared after readiness checks.');
	const cap = join(projectRoot, 'node_modules', '.bin', 'cap');
	if (!(await pathExists(cap)))
		throw new Error(
			'Capacitor CLI is not installed. Run absolute mobile init first.'
		);
	await writeAbsoluteCapacitorConfig(config, { projectRoot });
	await mkdir(config.bundleDirectory, { recursive: true });
	const placeholder = join(config.bundleDirectory, 'index.html');
	if (!(await pathExists(placeholder)))
		await writeFile(
			placeholder,
			'<!doctype html><title>AbsoluteJS mobile development</title>\n'
		);
	const nativeDirectory = join(config.nativeProjectDirectory, 'ios');
	if (!(await pathExists(nativeDirectory))) {
		if (!options.createNativeProject)
			throw new Error('iOS native project has not been created.');
		const run = options.run ?? defaultRun;
		if ((await run([cap, 'add', 'ios'], { cwd: projectRoot })) !== 0)
			throw new Error('Capacitor iOS project creation failed.');
	}

	return {
		cap,
		config,
		nativeDirectory,
		projectRoot,
		xcodebuild,
		xcrun
	};
};

export const startAbsoluteIosDevSession = async (
	options: StartAbsoluteIosDevOptions
): Promise<AbsoluteIosDevSession> => {
	const { project } = options;
	const capture = options.capture ?? defaultCapture;
	const run = options.run ?? defaultRun;
	const sleep = options.sleep ?? Bun.sleep;
	const spawn = options.spawn ?? defaultSpawn;
	const log = options.log ?? console.log;
	const startedAt = performance.now();
	let phaseStartedAt = performance.now();
	const timings: Record<string, number> = {};
	let state: AbsoluteIosDevState = 'syncing';
	const transition = (next: AbsoluteIosDevState) => {
		if (next === state) {
			options.onStateChange?.(next);

			return;
		}
		const now = performance.now();
		const durationMs = now - phaseStartedAt;
		timings[state] = (timings[state] ?? 0) + durationMs;
		options.onPhaseTiming?.({
			durationMs,
			phase: state,
			totalMs: now - startedAt
		});
		state = next;
		phaseStartedAt = now;
		options.onStateChange?.(next);
	};
	let nativeLogs: AbsoluteIosLogStream | null = null;
	const closeLogs = async () => {
		const stream = nativeLogs;
		nativeLogs = null;
		await stream?.close().catch(() => undefined);
	};
	try {
		await repairAbsoluteIosDevSession(project.projectRoot);
		throwIfAborted(options.signal);
		transition('syncing');
		await requireSuccess(
			[project.cap, 'sync', 'ios'],
			'Capacitor iOS synchronization',
			run,
			{ cwd: project.projectRoot, signal: options.signal }
		);
		transition('configuring');
		await writeDevProjection(project, options.port, options.https === true);
		throwIfAborted(options.signal);
		const fingerprintStartedAt = performance.now();
		const fingerprintPromise = fingerprintAbsoluteIosDevProject(
			project
		).then((fingerprint) => {
			timings.fingerprinting = performance.now() - fingerprintStartedAt;

			return fingerprint;
		});
		transition('booting');
		const { created, device } = await ensureManagedSimulator(
			project,
			capture
		);
		const startedSimulator = created || device.state !== 'Booted';
		bootSimulator(project, device, capture);
		spawn([
			'open',
			'-a',
			'Simulator',
			'--args',
			'-CurrentDeviceUDID',
			device.udid
		]);
		transition('connecting');
		await waitForBootedSimulator(
			project,
			device.udid,
			capture,
			sleep,
			options.signal
		);
		await requireSuccess(
			[project.xcrun, 'simctl', 'bootstatus', device.udid, '-b'],
			'iOS simulator boot readiness',
			run,
			{ signal: options.signal }
		);
		const fingerprint = await fingerprintPromise;
		transition('checking-native');
		const nativeCacheHit = await ensureIosDebugApp({
			cache: await readNativeCache(project.projectRoot),
			capture,
			fingerprint,
			log,
			project,
			run,
			signal: options.signal,
			transition,
			udid: device.udid
		});
		throwIfAborted(options.signal);
		if (options.nativeLog) transition('streaming-logs');
		nativeLogs = attachNativeLogs(project, device.udid, options);
		transition('launching');
		await requireSuccess(
			[
				project.xcrun,
				'simctl',
				'launch',
				'--terminate-running-process',
				device.udid,
				project.config.appId
			],
			'iOS app launch',
			run,
			{ signal: options.signal }
		);
		transition('ready');
		timings.total = performance.now() - startedAt;
		log(
			`iOS simulator connected (${device.udid}) with HMR on port ${options.port} in ${getDurationString(timings.total)} (${nativeCacheHit ? 'native cache hit' : 'native build installed'}).`
		);
		log(`iOS startup: ${timingSummary(timings)}.`);
		let closed = false;
		const close = async () => {
			if (closed) return;
			closed = true;
			transition('closing');
			await closeLogs();
			await repairAbsoluteIosDevSession(project.projectRoot);
			transition('closed');
		};

		return {
			close,
			nativeCacheHit,
			startedSimulator,
			timings: { ...timings },
			udid: device.udid,
			rebuild: async () => {
				if (closed)
					throw new Error('iOS development session is closed.');
				log(
					'iOS native inputs changed; rebuilding without restarting the dev server.'
				);
				await close();

				return startAbsoluteIosDevSession(options);
			},
			relaunch: async () => {
				if (closed)
					throw new Error('iOS development session is closed.');
				transition('launching');
				try {
					await requireSuccess(
						[
							project.xcrun,
							'simctl',
							'launch',
							'--terminate-running-process',
							device.udid,
							project.config.appId
						],
						'iOS app relaunch',
						run,
						{ signal: options.signal }
					);
					transition('ready');
					log(`iOS app relaunched on ${device.udid}.`);
				} catch (error) {
					transition('failed');

					throw error;
				}
			},
			screenshot: async (destination) => {
				const resolved = resolve(project.projectRoot, destination);
				if (!isInside(project.projectRoot, resolved))
					throw new Error(
						'iOS screenshot destination must remain inside the project.'
					);
				await mkdir(dirname(resolved), { recursive: true });
				await requireSuccess(
					[
						project.xcrun,
						'simctl',
						'io',
						device.udid,
						'screenshot',
						resolved
					],
					'iOS simulator screenshot',
					run,
					{ signal: options.signal }
				);

				return resolved;
			},
			get state() {
				return state;
			}
		};
	} catch (error) {
		transition('failed');
		await closeLogs();
		await repairAbsoluteIosDevSession(project.projectRoot);

		throw error;
	}
};
