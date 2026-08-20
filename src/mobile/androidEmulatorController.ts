import {
	access,
	copyFile,
	mkdir,
	readFile,
	rm,
	writeFile
} from 'node:fs/promises';
import {
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
	win32
} from 'node:path';
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
const HASH_RADIX = 16;
const CAPACITOR_PROJECT_DIRECTORY_PATTERN =
	/project\(['"](:[^'"]+)['"]\)\.projectDir\s*=\s*new File\(['"]([^'"]+)['"]\)/gu;

type CommandOptions = {
	cwd?: string;
	env?: Record<string, string | undefined>;
	signal?: AbortSignal;
};

type CommandResult = {
	exitCode: number;
	stderr: string;
	stdout: string;
};

export type AbsoluteAndroidDevState =
	| 'booting'
	| 'building'
	| 'closed'
	| 'closing'
	| 'configuring'
	| 'connecting'
	| 'failed'
	| 'forwarding'
	| 'installing'
	| 'launching'
	| 'ready'
	| 'streaming-logs'
	| 'syncing';

export type AbsoluteAndroidNativeLogEntry = {
	level: 'debug' | 'error' | 'fatal' | 'info' | 'verbose' | 'warn';
	message: string;
	tag: string;
};

type AbsoluteAndroidLogStream = {
	close: () => Promise<void>;
};

type AndroidDevJournal = {
	backupPath: string;
	format: number;
	manifestBackupPath?: string;
	nativeConfigPath: string;
	nativeManifestPath?: string;
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
	relaunch: () => Promise<void>;
	serial: string;
	state: AbsoluteAndroidDevState;
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
	nativeLog?: (entry: AbsoluteAndroidNativeLogEntry) => void;
	onStateChange?: (state: AbsoluteAndroidDevState) => void;
	https?: boolean;
	port: number;
	project: AbsoluteAndroidDevProject;
	run?: (command: string[], options?: CommandOptions) => Promise<number>;
	signal?: AbortSignal;
	sleep?: (milliseconds: number) => Promise<void>;
	spawn?: (command: string[], options?: CommandOptions) => void;
	startNativeLogs?: (
		command: string[],
		options: CommandOptions,
		onLine: (line: string) => void
	) => AbsoluteAndroidLogStream;
};

const pathExists = async (path: string) => {
	try {
		await access(path);

		return true;
	} catch {
		return false;
	}
};

const forwardCommandOutput = (
	stream: ReadableStream<Uint8Array>,
	destination: NodeJS.WriteStream
) =>
	stream.pipeTo(
		new WritableStream({
			write: (chunk) => {
				destination.write(chunk);
			}
		})
	);

const runCommand = async (command: string[], options: CommandOptions = {}) => {
	const subprocess = Bun.spawn(command, {
		cwd: options.cwd,
		env: options.env,
		signal: options.signal,
		stderr: 'pipe',
		stdin: 'ignore',
		stdout: 'pipe'
	});
	const [exitCode] = await Promise.all([
		subprocess.exited,
		forwardCommandOutput(subprocess.stdout, process.stdout),
		forwardCommandOutput(subprocess.stderr, process.stderr)
	]);

	return exitCode;
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

const LOGCAT_LINE_PATTERN =
	/^\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+\d+\s+\d+\s+([VDIWEF])\s+([^:]+):\s?(.*)$/u;
const ASCII_CONTROL_END = 31;
const ASCII_DELETE = 127;
const ASCII_ESCAPE = 27;
const ASCII_HORIZONTAL_TAB = 9;
const LOGCAT_MESSAGE_CAPTURE = 3;
const UNFOUND_INDEX = -1;
const ANSI_SEQUENCE_PATTERN = new RegExp(
	`${String.fromCharCode(ASCII_ESCAPE)}(?:\\[[0-?]*[ -/]*[@-~]|[@-_])`,
	'gu'
);
const AUTHORIZATION_SECRET_PATTERN =
	/(["']?(?:authorization|proxy-authorization)["']?\s*[:=]\s*)(?:Bearer|Basic)\s+[^\s,;]+/giu;
const BEARER_SECRET_PATTERN = /\b(Bearer)\s+[^\s,;]+/giu;
const COOKIE_SECRET_PATTERN =
	/(["']?(?:cookie|set-cookie)["']?\s*[:=]\s*).*/giu;
const NAMED_SECRET_PATTERN =
	/(["']?(?:access_token|refresh_token|id_token|client_secret|password|code|token)["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s&,;]+)/giu;
const QUERY_SECRET_PATTERN = /([?&](?:code|token)=)[^&\s]+/giu;

export const redactAbsoluteAndroidLog = (value: string) =>
	value
		.replace(ANSI_SEQUENCE_PATTERN, '')
		.split('')
		.filter((character) => {
			const code = character.charCodeAt(0);

			return (
				code === ASCII_HORIZONTAL_TAB ||
				(code > ASCII_CONTROL_END && code !== ASCII_DELETE)
			);
		})
		.join('')
		.replace(AUTHORIZATION_SECRET_PATTERN, '$1[REDACTED]')
		.replace(BEARER_SECRET_PATTERN, '$1 [REDACTED]')
		.replace(COOKIE_SECRET_PATTERN, '$1[REDACTED]')
		.replace(NAMED_SECRET_PATTERN, '$1[REDACTED]')
		.replace(QUERY_SECRET_PATTERN, '$1[REDACTED]');

const androidLogLevel = (level: string) => {
	if (level === 'V') return 'verbose';
	if (level === 'D') return 'debug';
	if (level === 'W') return 'warn';
	if (level === 'E') return 'error';
	if (level === 'F') return 'fatal';

	return 'info';
};

const emitCompleteLogLines = (
	value: string,
	onLine: (line: string) => void
) => {
	let buffered = value;
	let newlineIndex = buffered.indexOf('\n');
	while (newlineIndex !== UNFOUND_INDEX) {
		onLine(buffered.slice(0, newlineIndex).replace(/\r$/u, ''));
		buffered = buffered.slice(newlineIndex + 1);
		newlineIndex = buffered.indexOf('\n');
	}

	return buffered;
};

const decodeLogStream = () => {
	const decoder = new TextDecoder();

	return new TransformStream<Uint8Array, string>({
		flush: (controller) => {
			const remaining = decoder.decode();
			if (remaining) controller.enqueue(remaining);
		},
		transform: (chunk, controller) => {
			const decoded = decoder.decode(chunk, { stream: true });
			if (decoded) controller.enqueue(decoded);
		}
	});
};

export const parseAbsoluteAndroidLogLine = (
	line: string
): AbsoluteAndroidNativeLogEntry | null => {
	const sanitized = redactAbsoluteAndroidLog(line).trim();
	if (!sanitized) return null;
	const match = LOGCAT_LINE_PATTERN.exec(sanitized);
	if (!match) {
		return { level: 'info', message: sanitized, tag: 'logcat' };
	}

	return {
		level: androidLogLevel(match[1] ?? 'I'),
		message: match[LOGCAT_MESSAGE_CAPTURE] ?? '',
		tag: match[2]?.trim() || 'android'
	};
};

const consumeLogLines = async (
	stream: ReadableStream<Uint8Array>,
	onLine: (line: string) => void
) => {
	let buffered = '';
	await stream.pipeThrough(decodeLogStream()).pipeTo(
		new WritableStream({
			write: (chunk) => {
				buffered = emitCompleteLogLines(buffered + chunk, onLine);
			}
		})
	);
	if (buffered) {
		onLine(buffered.replace(/\r$/u, ''));
	}
};

const startNativeLogStream = (
	command: string[],
	options: CommandOptions,
	onLine: (line: string) => void
): AbsoluteAndroidLogStream => {
	const subprocess = Bun.spawn(command, {
		env: options.env,
		stderr: 'pipe',
		stdin: 'ignore',
		stdout: 'pipe'
	});
	const output = Promise.all([
		consumeLogLines(subprocess.stdout, onLine),
		consumeLogLines(subprocess.stderr, onLine)
	]);
	void output.catch(() => undefined);

	return {
		close: async () => {
			try {
				subprocess.kill();
			} catch {
				/* logcat already exited */
			}
			await Promise.all([
				subprocess.exited.catch(() => undefined),
				output.catch(() => undefined)
			]);
		}
	};
};

const requireSuccess = async (
	command: string[],
	label: string,
	run: NonNullable<StartAbsoluteAndroidDevOptions['run']>,
	options?: CommandOptions
) => {
	const exitCode = await run(command, options);
	throwIfAborted(options?.signal);
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
		manifestBackup: join(root, 'AndroidManifest.backup.xml'),
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
	const manifestBackupPath = Reflect.get(value, 'manifestBackupPath');
	const nativeConfigPath = Reflect.get(value, 'nativeConfigPath');
	const nativeManifestPath = Reflect.get(value, 'nativeManifestPath');
	if (
		typeof backupPath !== 'string' ||
		format !== DEV_JOURNAL_FORMAT ||
		typeof nativeConfigPath !== 'string'
	) {
		return null;
	}
	if (
		(manifestBackupPath !== undefined ||
			nativeManifestPath !== undefined) &&
		(typeof manifestBackupPath !== 'string' ||
			typeof nativeManifestPath !== 'string')
	) {
		return null;
	}

	return {
		backupPath,
		format,
		manifestBackupPath,
		nativeConfigPath,
		nativeManifestPath
	};
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
		!isInside(paths.root, journal.backupPath) ||
		(journal.nativeManifestPath !== undefined &&
			!isInside(projectRoot, journal.nativeManifestPath)) ||
		(journal.manifestBackupPath !== undefined &&
			!isInside(paths.root, journal.manifestBackupPath))
	) {
		throw new Error(
			`Refusing unsafe or invalid mobile dev journal at ${paths.journal}.`
		);
	}
	if (await pathExists(journal.backupPath)) {
		await mkdir(dirname(journal.nativeConfigPath), { recursive: true });
		await copyFile(journal.backupPath, journal.nativeConfigPath);
	}
	if (
		journal.manifestBackupPath &&
		journal.nativeManifestPath &&
		(await pathExists(journal.manifestBackupPath))
	) {
		await mkdir(dirname(journal.nativeManifestPath), { recursive: true });
		await copyFile(journal.manifestBackupPath, journal.nativeManifestPath);
	}
	await rm(paths.root, { force: true, recursive: true });

	return true;
};

const androidDevelopmentManifest = (source: string, cleartext: boolean) => {
	if (!cleartext) return source;
	if (/android:usesCleartextTraffic=["'][^"']*["']/u.test(source)) {
		return source.replace(
			/android:usesCleartextTraffic=["'][^"']*["']/u,
			'android:usesCleartextTraffic="true"'
		);
	}

	return source.replace(
		'<application',
		'<application\n        android:usesCleartextTraffic="true"'
	);
};

const writeDevConfig = async (
	projectRoot: string,
	nativeConfigPath: string,
	nativeManifestPath: string,
	port: number,
	https: boolean,
	entry: string
) => {
	const paths = journalPaths(projectRoot);
	await repairAbsoluteAndroidDevSession(projectRoot);
	const source = await readFile(nativeConfigPath, 'utf8');
	const manifestSource = await readFile(nativeManifestPath, 'utf8');
	const parsed: unknown = JSON.parse(source);
	if (!isRecord(parsed)) {
		throw new Error(
			`Invalid Capacitor native config at ${nativeConfigPath}.`
		);
	}
	await mkdir(paths.root, { recursive: true });
	await writeFile(paths.backup, source, { flag: 'wx' });
	await writeFile(paths.manifestBackup, manifestSource, { flag: 'wx' });
	const journal: AndroidDevJournal = {
		backupPath: paths.backup,
		format: DEV_JOURNAL_FORMAT,
		manifestBackupPath: paths.manifestBackup,
		nativeConfigPath,
		nativeManifestPath
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
		url: `${https ? 'https' : 'http'}://localhost:${port}${entry}`
	};
	await writeFile(
		nativeConfigPath,
		`${JSON.stringify(parsed, null, '\t')}\n`
	);
	await writeFile(
		nativeManifestPath,
		androidDevelopmentManifest(manifestSource, !https)
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

type WindowsGradleDependency = {
	name: string;
	windowsSource: string;
};

const mirroredCapacitorDependencies = async (
	project: AbsoluteAndroidDevProject,
	capture: NonNullable<StartAbsoluteAndroidDevOptions['capture']>
) => {
	const settingsPath = join(
		project.nativeDirectory,
		'capacitor.settings.gradle'
	);
	const settings = await readFile(settingsPath, 'utf8');
	const dependencies: WindowsGradleDependency[] = [];
	const rewrittenSettings = settings.replace(
		CAPACITOR_PROJECT_DIRECTORY_PATTERN,
		(_statement, projectName: string, sourcePath: string) => {
			const name = projectName
				.slice(1)
				.replaceAll(/[^a-zA-Z0-9_.-]/gu, '_');
			const source = resolve(project.nativeDirectory, sourcePath);
			dependencies.push({
				name,
				windowsSource: windowsPathFromWsl(source, capture)
			});

			return `project('${projectName}').projectDir = new File('./.absolutejs-dependencies/${name}')`;
		}
	);
	if (dependencies.length === 0) {
		throw new Error(
			'Capacitor Android settings did not declare any native dependencies.'
		);
	}

	return { dependencies, rewrittenSettings };
};

const encodedWindowsGradleCommand = (
	windowsSource: string,
	windowsDirectory: string,
	windowsAndroidRoot: string,
	dependencies: WindowsGradleDependency[],
	rewrittenSettings: string
) => {
	const sourceDirectory = Buffer.from(windowsSource, 'utf8').toString(
		'base64'
	);
	const buildDirectory = Buffer.from(windowsDirectory, 'utf8').toString(
		'base64'
	);
	const androidRoot = Buffer.from(windowsAndroidRoot, 'utf8').toString(
		'base64'
	);
	const dependencyData = Buffer.from(
		JSON.stringify(dependencies),
		'utf8'
	).toString('base64');
	const settingsData = Buffer.from(rewrittenSettings, 'utf8').toString(
		'base64'
	);
	const source = [
		"$ErrorActionPreference = 'Stop'",
		`$source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${sourceDirectory}'))`,
		`$directory = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${buildDirectory}'))`,
		`$androidHome = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${androidRoot}'))`,
		`$dependencies = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${dependencyData}')) | ConvertFrom-Json`,
		`$settings = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${settingsData}'))`,
		'$env:ANDROID_HOME = $androidHome',
		'$env:ANDROID_SDK_ROOT = $androidHome',
		'New-Item -ItemType Directory -Force -Path $directory | Out-Null',
		'& robocopy.exe $source $directory /MIR /XD .gradle build .absolutejs-dependencies /NFL /NDL /NJH /NJS /NP',
		'$copyExit = $LASTEXITCODE',
		'if ($copyExit -ge 8) { exit $copyExit }',
		"foreach ($dependency in @($dependencies)) { $target = Join-Path $directory ('.absolutejs-dependencies\\' + $dependency.name); New-Item -ItemType Directory -Force -Path $target | Out-Null; & robocopy.exe $dependency.windowsSource $target /MIR /XD .gradle build /NFL /NDL /NJH /NJS /NP; if ($LASTEXITCODE -ge 8) { exit $LASTEXITCODE } }",
		"[IO.File]::WriteAllText((Join-Path $directory 'capacitor.settings.gradle'), $settings)",
		"$wrapper = Join-Path $directory 'gradlew.bat'",
		'& $wrapper --no-daemon --console=plain -p $directory assembleDebug',
		'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
		'exit 0'
	].join('; ');

	return Buffer.from(source, 'utf16le').toString('base64');
};

const buildAndroidDebugApp = async (
	project: AbsoluteAndroidDevProject,
	capture: NonNullable<StartAbsoluteAndroidDevOptions['capture']>,
	run: NonNullable<StartAbsoluteAndroidDevOptions['run']>,
	env: Record<string, string | undefined>,
	signal?: AbortSignal
) => {
	if (project.host === 'wsl') {
		const windowsSource = windowsPathFromWsl(
			project.nativeDirectory,
			capture
		);
		const buildId = Bun.hash(project.projectRoot).toString(HASH_RADIX);
		const managedBuildDirectory = resolve(
			project.androidRoot,
			'..',
			'..',
			'Builds',
			`${project.config.appId}-${buildId}`
		);
		const windowsDirectory = windowsPathFromWsl(
			managedBuildDirectory,
			capture
		);
		const windowsAndroidRoot = windowsPathFromWsl(
			project.androidRoot,
			capture
		);
		const { dependencies, rewrittenSettings } =
			await mirroredCapacitorDependencies(project, capture);
		await requireSuccess(
			[
				'powershell.exe',
				'-NoProfile',
				'-EncodedCommand',
				encodedWindowsGradleCommand(
					windowsSource,
					windowsDirectory,
					windowsAndroidRoot,
					dependencies,
					rewrittenSettings
				)
			],
			'Android Gradle build',
			run,
			{ env, signal }
		);

		return win32.join(
			windowsDirectory,
			'app',
			'build',
			'outputs',
			'apk',
			'debug',
			'app-debug.apk'
		);
	}
	const wrapper = project.host === 'windows' ? 'gradlew.bat' : './gradlew';
	await requireSuccess(
		[wrapper, '--no-daemon', '--console=plain', 'assembleDebug'],
		'Android Gradle build',
		run,
		{ cwd: project.nativeDirectory, env, signal }
	);

	return join(
		project.nativeDirectory,
		'app',
		'build',
		'outputs',
		'apk',
		'debug',
		'app-debug.apk'
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

const androidLaunchCommand = (
	project: AbsoluteAndroidDevProject,
	serial: string
) => [
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
];

const androidPackageUid = (
	project: AbsoluteAndroidDevProject,
	serial: string,
	capture: NonNullable<StartAbsoluteAndroidDevOptions['capture']>,
	env: Record<string, string | undefined>
) => {
	const result = capture(
		[
			project.adb,
			'-s',
			serial,
			'shell',
			'cmd',
			'package',
			'list',
			'packages',
			'-U',
			project.config.appId
		],
		{ env }
	);
	if (result.exitCode !== 0) return undefined;
	const escapedAppId = project.config.appId.replace(
		/[.*+?^${}()|[\]\\]/gu,
		'\\$&'
	);
	const match = new RegExp(`package:${escapedAppId}\\s+uid:(\\d+)`, 'u').exec(
		result.stdout
	);

	return match?.[1];
};

const attachAndroidNativeLogs = (
	project: AbsoluteAndroidDevProject,
	serial: string,
	capture: NonNullable<StartAbsoluteAndroidDevOptions['capture']>,
	env: Record<string, string | undefined>,
	options: StartAbsoluteAndroidDevOptions
) => {
	if (!options.nativeLog) return null;
	const uid = androidPackageUid(project, serial, capture, env);
	if (!uid) {
		options.log?.(
			`Android app logs unavailable: could not resolve the package UID for ${project.config.appId}.`
		);

		return null;
	}
	const onLine = (line: string) => {
		const entry = parseAbsoluteAndroidLogLine(line);
		if (entry) options.nativeLog?.(entry);
	};

	return (options.startNativeLogs ?? startNativeLogStream)(
		[
			project.adb,
			'-s',
			serial,
			'logcat',
			`--uid=${uid}`,
			'-v',
			'threadtime',
			'-T',
			'1',
			'*:W',
			'Capacitor:V',
			'Capacitor/Console:V',
			'chromium:I'
		],
		{ env },
		onLine
	);
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
	let state: AbsoluteAndroidDevState = 'syncing';
	const transition = (next: AbsoluteAndroidDevState) => {
		state = next;
		options.onStateChange?.(next);
	};
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
	transition('syncing');
	await repairAbsoluteAndroidDevSession(project.projectRoot);
	throwIfAborted(options.signal);
	await requireSuccess(
		[project.cap, 'sync', 'android'],
		'Capacitor Android synchronization',
		run,
		{ cwd: project.projectRoot, env, signal: options.signal }
	);
	throwIfAborted(options.signal);
	transition('configuring');
	const nativeConfigPath = join(
		project.nativeDirectory,
		'app',
		'src',
		'main',
		'assets',
		'capacitor.config.json'
	);
	const nativeManifestPath = join(
		project.nativeDirectory,
		'app',
		'src',
		'main',
		'AndroidManifest.xml'
	);
	let connectedSerial: string | undefined;
	let nativeLogs: AbsoluteAndroidLogStream | null = null;
	const closeNativeLogs = async () => {
		const stream = nativeLogs;
		nativeLogs = null;
		await stream?.close().catch(() => undefined);
	};
	try {
		await writeDevConfig(
			project.projectRoot,
			nativeConfigPath,
			nativeManifestPath,
			options.port,
			options.https === true,
			project.config.entry
		);
		throwIfAborted(options.signal);
		logHttpsCertificateRequirement(options.https, log);
		transition('booting');
		const startedEmulator = startManagedEmulatorIfNeeded(
			project,
			capture,
			spawn,
			log,
			env
		);
		transition('connecting');
		const serial = await waitForManagedEmulator(
			project,
			capture,
			sleep,
			env,
			options.signal
		);
		connectedSerial = serial;
		transition('forwarding');
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
			{ env, signal: options.signal }
		);
		throwIfAborted(options.signal);
		transition('building');
		const installPath = await buildAndroidDebugApp(
			project,
			capture,
			run,
			env,
			options.signal
		);
		throwIfAborted(options.signal);
		transition('installing');
		await requireSuccess(
			[project.adb, '-s', serial, 'install', '-r', installPath],
			'Android app installation',
			run,
			{ env, signal: options.signal }
		);
		throwIfAborted(options.signal);
		transition('launching');
		await requireSuccess(
			androidLaunchCommand(project, serial),
			'Android app launch',
			run,
			{ env, signal: options.signal }
		);
		throwIfAborted(options.signal);
		if (options.nativeLog) transition('streaming-logs');
		nativeLogs = attachAndroidNativeLogs(
			project,
			serial,
			capture,
			env,
			options
		);
		transition('ready');
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
				transition('closing');
				await closeNativeLogs();
				await removeAdbReverse(project, serial, options.port, run, env);
				await repairAbsoluteAndroidDevSession(project.projectRoot);
				transition('closed');
			},
			relaunch: async () => {
				if (closed) {
					throw new Error('Android development session is closed.');
				}
				transition('launching');
				try {
					await requireSuccess(
						androidLaunchCommand(project, serial),
						'Android app relaunch',
						run,
						{ env, signal: options.signal }
					);
					transition('ready');
					log(`Android app relaunched on ${serial}.`);
				} catch (error) {
					transition('failed');

					throw error;
				}
			},
			get state() {
				return state;
			}
		};
	} catch (error) {
		transition('failed');
		await closeNativeLogs();
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
