import {
	access,
	copyFile,
	mkdir,
	readFile,
	rm,
	writeFile
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
	ABSOLUTE_ANDROID_AVD_NAME,
	absoluteManagedAndroidSdkRoot,
	detectAbsoluteMobileHost,
	inspectAbsoluteMobileToolchain,
	type AbsoluteMobileHost
} from './emulatorDoctor';
import type { NormalizedAbsoluteMobileConfig } from './config';
import { writeAbsoluteCapacitorConfig } from './capacitorProject';

const ANDROID_BOOT_TIMEOUT_MS = 180_000;
const ANDROID_BOOT_POLL_MS = 1_000;
const DEV_JOURNAL_FORMAT = 1;

type CommandOptions = {
	cwd?: string;
	env?: Record<string, string | undefined>;
};

type CommandResult = {
	exitCode: number;
	stderr: string;
	stdout: string;
};

type AndroidDevJournal = {
	backupPath: string;
	format: number;
	nativeConfigPath: string;
};

export type AbsoluteAndroidDevProject = {
	adb: string;
	androidRoot: string;
	cap: string;
	config: NormalizedAbsoluteMobileConfig;
	emulator: string;
	host: AbsoluteMobileHost;
	nativeDirectory: string;
	projectRoot: string;
};

export type AbsoluteAndroidDevSession = {
	close: () => Promise<void>;
	serial: string;
	startedEmulator: boolean;
};

export type PrepareAbsoluteAndroidDevOptions = {
	createNativeProject: boolean;
	projectRoot: string;
	run?: (command: string[], options?: CommandOptions) => Promise<number>;
};

export type StartAbsoluteAndroidDevOptions = {
	capture?: (command: string[], options?: CommandOptions) => CommandResult;
	log?: (message: string) => void;
	https?: boolean;
	port: number;
	project: AbsoluteAndroidDevProject;
	run?: (command: string[], options?: CommandOptions) => Promise<number>;
	signal?: AbortSignal;
	sleep?: (milliseconds: number) => Promise<void>;
	spawn?: (command: string[], options?: CommandOptions) => void;
};

const pathExists = async (path: string) => {
	try {
		await access(path);

		return true;
	} catch {
		return false;
	}
};

const runCommand = async (command: string[], options: CommandOptions = {}) => {
	const subprocess = Bun.spawn(command, {
		cwd: options.cwd,
		env: options.env,
		stderr: 'inherit',
		stdin: 'inherit',
		stdout: 'inherit'
	});

	return subprocess.exited;
};

const captureCommand = (command: string[], options: CommandOptions = {}) => {
	try {
		const result = Bun.spawnSync(command, {
			cwd: options.cwd,
			env: options.env,
			stderr: 'pipe',
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

const spawnCommand = (command: string[], options: CommandOptions = {}) => {
	Bun.spawn(command, {
		cwd: options.cwd,
		env: options.env,
		stderr: 'ignore',
		stdin: 'ignore',
		stdout: 'ignore'
	});
};

const requireSuccess = async (
	command: string[],
	label: string,
	run: NonNullable<StartAbsoluteAndroidDevOptions['run']>,
	options?: CommandOptions
) => {
	const exitCode = await run(command, options);
	if (exitCode !== 0) throw new Error(`${label} failed (exit ${exitCode}).`);
};

const throwIfAborted = (signal?: AbortSignal) => {
	if (!signal?.aborted) return;
	throw new DOMException(
		'Android development startup was cancelled.',
		'AbortError'
	);
};

const journalPaths = (projectRoot: string) => {
	const root = join(projectRoot, '.absolutejs', 'mobile', 'dev-session');

	return {
		backup: join(root, 'capacitor.config.backup.json'),
		journal: join(root, 'journal.json'),
		root
	};
};

const isInside = (root: string, path: string) => {
	const resolvedRoot = resolve(root);
	const resolvedPath = resolve(path);
	const relativePath = relative(resolvedRoot, resolvedPath);

	return (
		relativePath === '' ||
		(relativePath !== '..' &&
			!relativePath.startsWith(`..${sep}`) &&
			!isAbsolute(relativePath))
	);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const parseJournal = (value: unknown): AndroidDevJournal | null => {
	if (typeof value !== 'object' || value === null) return null;
	const backupPath = Reflect.get(value, 'backupPath');
	const format = Reflect.get(value, 'format');
	const nativeConfigPath = Reflect.get(value, 'nativeConfigPath');
	if (
		typeof backupPath !== 'string' ||
		format !== DEV_JOURNAL_FORMAT ||
		typeof nativeConfigPath !== 'string'
	) {
		return null;
	}

	return { backupPath, format, nativeConfigPath };
};

export const repairAbsoluteAndroidDevSession = async (projectRoot: string) => {
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
		!isInside(paths.root, journal.backupPath)
	) {
		throw new Error(
			`Refusing unsafe or invalid mobile dev journal at ${paths.journal}.`
		);
	}
	if (await pathExists(journal.backupPath)) {
		await mkdir(dirname(journal.nativeConfigPath), { recursive: true });
		await copyFile(journal.backupPath, journal.nativeConfigPath);
	}
	await rm(paths.root, { force: true, recursive: true });

	return true;
};

const writeDevConfig = async (
	projectRoot: string,
	nativeConfigPath: string,
	port: number,
	https: boolean
) => {
	const paths = journalPaths(projectRoot);
	await repairAbsoluteAndroidDevSession(projectRoot);
	const source = await readFile(nativeConfigPath, 'utf8');
	const parsed: unknown = JSON.parse(source);
	if (!isRecord(parsed)) {
		throw new Error(
			`Invalid Capacitor native config at ${nativeConfigPath}.`
		);
	}
	await mkdir(paths.root, { recursive: true });
	await writeFile(paths.backup, source, { flag: 'wx' });
	const journal: AndroidDevJournal = {
		backupPath: paths.backup,
		format: DEV_JOURNAL_FORMAT,
		nativeConfigPath
	};
	await writeFile(paths.journal, `${JSON.stringify(journal, null, '\t')}\n`, {
		flag: 'wx'
	});
	const currentServer = parsed.server;
	parsed.server = {
		...(typeof currentServer === 'object' && currentServer !== null
			? currentServer
			: {}),
		cleartext: !https,
		url: `${https ? 'https' : 'http'}://localhost:${port}`
	};
	await writeFile(
		nativeConfigPath,
		`${JSON.stringify(parsed, null, '\t')}\n`
	);
};

export const parseAdbDevices = (output: string) =>
	output
		.split(/\r?\n/)
		.slice(1)
		.map((line) => line.trim().split(/\s+/, 2))
		.filter(
			(parts): parts is [string, string] =>
				parts.length === 2 && parts[1] === 'device'
		)
		.map(([serial]) => serial);

const isManagedEmulatorSerial = (
	serial: string,
	adb: string,
	capture: NonNullable<StartAbsoluteAndroidDevOptions['capture']>,
	env: Record<string, string | undefined>
) => {
	if (!serial.startsWith('emulator-')) return false;
	const avd = capture([adb, '-s', serial, 'emu', 'avd', 'name'], { env });

	return (
		avd.exitCode === 0 &&
		avd.stdout
			.split(/\r?\n/)
			.map((value) => value.trim())
			.includes(ABSOLUTE_ANDROID_AVD_NAME)
	);
};

const managedEmulatorSerial = (
	adb: string,
	capture: NonNullable<StartAbsoluteAndroidDevOptions['capture']>,
	env: Record<string, string | undefined>
) => {
	const devices = capture([adb, 'devices'], { env });
	if (devices.exitCode !== 0) return undefined;

	return parseAdbDevices(devices.stdout).find((serial) =>
		isManagedEmulatorSerial(serial, adb, capture, env)
	);
};

const completedBootSerial = (
	project: AbsoluteAndroidDevProject,
	capture: NonNullable<StartAbsoluteAndroidDevOptions['capture']>,
	env: Record<string, string | undefined>
) => {
	const serial = managedEmulatorSerial(project.adb, capture, env);
	if (!serial) return undefined;
	const booted = capture(
		[project.adb, '-s', serial, 'shell', 'getprop', 'sys.boot_completed'],
		{ env }
	);

	return booted.exitCode === 0 && booted.stdout.trim() === '1'
		? serial
		: undefined;
};

const waitForManagedEmulator = async (
	project: AbsoluteAndroidDevProject,
	capture: NonNullable<StartAbsoluteAndroidDevOptions['capture']>,
	sleep: NonNullable<StartAbsoluteAndroidDevOptions['sleep']>,
	env: Record<string, string | undefined>,
	signal?: AbortSignal
) => {
	const deadline = Date.now() + ANDROID_BOOT_TIMEOUT_MS;
	const poll = async () => {
		throwIfAborted(signal);
		const serial = completedBootSerial(project, capture, env);
		if (serial) return serial;
		if (Date.now() >= deadline) {
			throw new Error(
				`Android emulator ${ABSOLUTE_ANDROID_AVD_NAME} did not finish booting within ${ANDROID_BOOT_TIMEOUT_MS / ANDROID_BOOT_POLL_MS}s.`
			);
		}
		await sleep(ANDROID_BOOT_POLL_MS);

		return poll();
	};

	return poll();
};

const windowsPathFromWsl = (
	path: string,
	capture: NonNullable<StartAbsoluteAndroidDevOptions['capture']>
) => {
	const result = capture(['wslpath', '-w', path]);
	if (result.exitCode !== 0 || !result.stdout.trim()) {
		throw new Error(`Could not translate WSL path for Windows: ${path}`);
	}

	return result.stdout.trim();
};

const buildAndroidDebugApp = async (
	project: AbsoluteAndroidDevProject,
	capture: NonNullable<StartAbsoluteAndroidDevOptions['capture']>,
	run: NonNullable<StartAbsoluteAndroidDevOptions['run']>,
	env: Record<string, string | undefined>
) => {
	if (project.host === 'wsl') {
		const windowsDirectory = windowsPathFromWsl(
			project.nativeDirectory,
			capture
		);
		await requireSuccess(
			[
				'powershell.exe',
				'-NoProfile',
				'-Command',
				'param($directory) Set-Location -LiteralPath $directory; & .\\gradlew.bat assembleDebug; exit $LASTEXITCODE',
				windowsDirectory
			],
			'Android Gradle build',
			run,
			{ env }
		);

		return;
	}
	const wrapper = project.host === 'windows' ? 'gradlew.bat' : './gradlew';
	await requireSuccess(
		[wrapper, 'assembleDebug'],
		'Android Gradle build',
		run,
		{ cwd: project.nativeDirectory, env }
	);
};

const startManagedEmulatorIfNeeded = (
	project: AbsoluteAndroidDevProject,
	capture: NonNullable<StartAbsoluteAndroidDevOptions['capture']>,
	spawn: NonNullable<StartAbsoluteAndroidDevOptions['spawn']>,
	log: NonNullable<StartAbsoluteAndroidDevOptions['log']>,
	env: Record<string, string | undefined>
) => {
	if (managedEmulatorSerial(project.adb, capture, env)) return false;
	log(`Starting Android emulator ${ABSOLUTE_ANDROID_AVD_NAME}...`);
	spawn(
		[
			project.emulator,
			'-avd',
			ABSOLUTE_ANDROID_AVD_NAME,
			'-netdelay',
			'none',
			'-netspeed',
			'full'
		],
		{ env }
	);

	return true;
};

const logHttpsCertificateRequirement = (
	https: boolean | undefined,
	log: NonNullable<StartAbsoluteAndroidDevOptions['log']>
) => {
	if (https !== true) return;
	log(
		'Android HMR is using HTTPS; the emulator must trust the local development certificate authority.'
	);
};

const removeAdbReverse = async (
	project: AbsoluteAndroidDevProject,
	serial: string | undefined,
	port: number,
	run: NonNullable<StartAbsoluteAndroidDevOptions['run']>,
	env: Record<string, string | undefined>
) => {
	if (!serial) return;
	await run(
		[project.adb, '-s', serial, 'reverse', '--remove', `tcp:${port}`],
		{ env }
	).catch(() => undefined);
};

export const prepareAbsoluteAndroidDevProject = async (
	config: NormalizedAbsoluteMobileConfig,
	options: PrepareAbsoluteAndroidDevOptions
): Promise<AbsoluteAndroidDevProject> => {
	const projectRoot = resolve(options.projectRoot);
	const host = detectAbsoluteMobileHost();
	const androidRoot =
		process.env.ANDROID_HOME ??
		process.env.ANDROID_SDK_ROOT ??
		absoluteManagedAndroidSdkRoot(host);
	const checks = await inspectAbsoluteMobileToolchain({ androidRoot, host });
	const failed = checks.filter(
		(check) =>
			check.platform === 'android' &&
			(check.status === 'fail' || check.status === 'warn')
	);
	if (failed.length > 0) {
		throw new Error(
			`Android emulation is not ready: ${failed.map(({ label }) => label).join(', ')}.`
		);
	}
	const adb = checks.find((check) => check.id === 'android.adb')?.path;
	const emulator = checks.find(
		(check) => check.id === 'android.emulator'
	)?.path;
	if (!adb || !emulator) {
		throw new Error(
			'Android SDK tools disappeared after readiness checks.'
		);
	}
	const cap = join(
		projectRoot,
		'node_modules',
		'.bin',
		host === 'windows' ? 'cap.cmd' : 'cap'
	);
	if (!(await pathExists(cap))) {
		throw new Error(
			'Capacitor CLI is not installed. Run absolute mobile init first.'
		);
	}
	await writeAbsoluteCapacitorConfig(config, { projectRoot });
	await mkdir(config.bundleDirectory, { recursive: true });
	const placeholder = join(config.bundleDirectory, 'index.html');
	if (!(await pathExists(placeholder))) {
		await writeFile(
			placeholder,
			'<!doctype html><title>AbsoluteJS mobile development</title>\n'
		);
	}
	const nativeDirectory = join(config.nativeProjectDirectory, 'android');
	if (!(await pathExists(nativeDirectory))) {
		if (!options.createNativeProject) {
			throw new Error('Android native project has not been created.');
		}
		const run = options.run ?? runCommand;
		if (
			(await run([cap, 'add', 'android'], {
				cwd: projectRoot
			})) !== 0
		) {
			throw new Error('Capacitor Android project creation failed.');
		}
	}

	return {
		adb,
		androidRoot,
		cap,
		config,
		emulator,
		host,
		nativeDirectory,
		projectRoot
	};
};

export const startAbsoluteAndroidDevSession = async (
	options: StartAbsoluteAndroidDevOptions
) => {
	const { project } = options;
	const capture = options.capture ?? captureCommand;
	const run = options.run ?? runCommand;
	const sleep = options.sleep ?? Bun.sleep;
	const spawn = options.spawn ?? spawnCommand;
	const log = options.log ?? console.log;
	const androidHome =
		project.host === 'wsl'
			? windowsPathFromWsl(project.androidRoot, capture)
			: project.androidRoot;
	const env: Record<string, string | undefined> = {
		...process.env,
		ANDROID_HOME: androidHome
	};
	await repairAbsoluteAndroidDevSession(project.projectRoot);
	throwIfAborted(options.signal);
	await requireSuccess(
		[project.cap, 'sync', 'android'],
		'Capacitor Android synchronization',
		run,
		{ cwd: project.projectRoot, env }
	);
	throwIfAborted(options.signal);
	const nativeConfigPath = join(
		project.nativeDirectory,
		'app',
		'src',
		'main',
		'assets',
		'capacitor.config.json'
	);
	let connectedSerial: string | undefined;
	try {
		await writeDevConfig(
			project.projectRoot,
			nativeConfigPath,
			options.port,
			options.https === true
		);
		throwIfAborted(options.signal);
		logHttpsCertificateRequirement(options.https, log);
		const startedEmulator = startManagedEmulatorIfNeeded(
			project,
			capture,
			spawn,
			log,
			env
		);
		const serial = await waitForManagedEmulator(
			project,
			capture,
			sleep,
			env,
			options.signal
		);
		connectedSerial = serial;
		await requireSuccess(
			[
				project.adb,
				'-s',
				serial,
				'reverse',
				`tcp:${options.port}`,
				`tcp:${options.port}`
			],
			'ADB reverse port forwarding',
			run,
			{ env }
		);
		throwIfAborted(options.signal);
		await buildAndroidDebugApp(project, capture, run, env);
		throwIfAborted(options.signal);
		const apk = join(
			project.nativeDirectory,
			'app',
			'build',
			'outputs',
			'apk',
			'debug',
			'app-debug.apk'
		);
		const installPath =
			project.host === 'wsl' ? windowsPathFromWsl(apk, capture) : apk;
		await requireSuccess(
			[project.adb, '-s', serial, 'install', '-r', installPath],
			'Android app installation',
			run,
			{ env }
		);
		throwIfAborted(options.signal);
		await requireSuccess(
			[
				project.adb,
				'-s',
				serial,
				'shell',
				'monkey',
				'-p',
				project.config.appId,
				'-c',
				'android.intent.category.LAUNCHER',
				'1'
			],
			'Android app launch',
			run,
			{ env }
		);
		throwIfAborted(options.signal);
		log(
			`Android emulator connected (${serial}) with HMR on port ${options.port}.`
		);
		let closed = false;

		return {
			serial,
			startedEmulator,
			close: async () => {
				if (closed) return;
				closed = true;
				await removeAdbReverse(project, serial, options.port, run, env);
				await repairAbsoluteAndroidDevSession(project.projectRoot);
			}
		};
	} catch (error) {
		await removeAdbReverse(
			project,
			connectedSerial,
			options.port,
			run,
			env
		);
		await repairAbsoluteAndroidDevSession(project.projectRoot);

		throw error;
	}
};
