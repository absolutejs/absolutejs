import { spawn, type ChildProcess } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join, resolve as resolvePath } from 'node:path';
import type { NormalizedAbsoluteMobileConfig } from './config';
import {
	absoluteManagedAndroidSdkRoot,
	detectAbsoluteMobileHost,
	type AbsoluteMobileHost
} from './emulatorDoctor';
import {
	startAbsoluteIosCaEnrollmentServer,
	type AbsoluteIosCaEnrollmentServer
} from './iosPhysicalDeviceTransport';

export type AbsoluteExpoDevPlatform = 'android' | 'ios';
export type AbsoluteExpoDevState =
	| 'building-android'
	| 'building-ios'
	| 'closed'
	| 'enrolling-trust'
	| 'failed'
	| 'preparing-native'
	| 'ready'
	| 'starting-metro';

export type AbsoluteExpoDevCommand = {
	args: string[];
	env: Record<string, string>;
	platform?: AbsoluteExpoDevPlatform;
	role: 'metro' | 'native-build' | 'native-prepare';
};

export type AbsoluteExpoDevPlan = {
	commands: AbsoluteExpoDevCommand[];
	metroPort: number;
	project: string;
};

export type PlanAbsoluteExpoDevOptions = {
	androidDevice?: string;
	androidOrigin?: string;
	certificateAuthorityPath?: string;
	iosDevice?: string;
	iosOrigin?: string;
	metroHost?: string;
	metroPort: number;
	/** The caller owns Metro, for example through a Remote Mac tunnel. */
	metro?: 'external' | 'managed';
	platforms: AbsoluteExpoDevPlatform[];
};

export type AbsoluteExpoDevPhaseTiming = {
	durationMs: number;
	phase: AbsoluteExpoDevState;
};

export type StartAbsoluteExpoDevOptions = PlanAbsoluteExpoDevOptions & {
	androidAdb?: string;
	androidRoot?: string;
	capture?: (command: string[]) => { exitCode: number; stdout: string };
	config: NormalizedAbsoluteMobileConfig;
	executable?: string;
	host?: AbsoluteMobileHost;
	log?: (message: string) => void;
	onPhaseTiming?: (timing: AbsoluteExpoDevPhaseTiming) => void;
	onStateChange?: (state: AbsoluteExpoDevState) => void;
	signal?: AbortSignal;
	spawnProcess?: typeof spawn;
	startCaEnrollmentServer?: typeof startAbsoluteIosCaEnrollmentServer;
};

export type AbsoluteExpoDevSession = {
	close: () => Promise<void>;
	metroPort: number;
	platforms: AbsoluteExpoDevPlatform[];
	timings: Partial<Record<AbsoluteExpoDevState, number>>;
};

const METRO_READY_TIMEOUT_MS = 60_000;
const PROCESS_CLOSE_TIMEOUT_MS = 2_000;

const preserveWindowsSubstRealpaths = `
const fs = require('node:fs');
const path = require('node:path');
const physicalRoot = process.env.ABSOLUTE_EXPO_PHYSICAL_ROOT;
const mappedRoot = process.env.ABSOLUTE_EXPO_MAPPED_ROOT;
const remap = (value) => {
	if (typeof value !== 'string' || !physicalRoot || !mappedRoot) return value;
	const normalizedValue = path.resolve(value);
	const normalizedRoot = path.resolve(physicalRoot);
	if (normalizedValue.toLowerCase() === normalizedRoot.toLowerCase()) return mappedRoot;
	const prefix = normalizedRoot.endsWith(path.sep) ? normalizedRoot : normalizedRoot + path.sep;
	return normalizedValue.toLowerCase().startsWith(prefix.toLowerCase())
		? path.join(mappedRoot, normalizedValue.slice(prefix.length))
		: value;
};
const realpath = fs.realpath.bind(fs);
const realpathSync = fs.realpathSync.bind(fs);
const realpathNative = fs.realpathSync.native?.bind(fs.realpathSync);
fs.realpath = (value, options, callback) => {
	const done = typeof options === 'function' ? options : callback;
	const encoding = typeof options === 'function' ? undefined : options;
	return realpath(value, encoding, (error, result) => done(error, remap(result)));
};
fs.realpathSync = (value, options) => remap(realpathSync(value, options));
if (realpathNative) fs.realpathSync.native = (value, options) => remap(realpathNative(value, options));
const promiseRealpath = fs.promises.realpath.bind(fs.promises);
fs.promises.realpath = async (value, options) => remap(await promiseRealpath(value, options));
`;

const expoDevelopmentClientScheme = (appId: string) =>
	`exp+${appId.toLowerCase().replaceAll(/[^a-z0-9]+/gu, '-')}`;

const expoDevelopmentClientUrl = (appId: string, host: string, port: number) =>
	`${expoDevelopmentClientScheme(appId)}://expo-development-client/?url=${encodeURIComponent(`http://${host}:${port}`)}`;

const captureCommand = (command: string[]) => {
	const result = Bun.spawnSync(command, {
		stderr: 'ignore',
		stdout: 'pipe'
	});

	return { exitCode: result.exitCode, stdout: result.stdout.toString() };
};

const windowsPathFromWsl = (
	path: string,
	capture: NonNullable<StartAbsoluteExpoDevOptions['capture']>
) => {
	const result = capture(['wslpath', '-w', path]);
	if (result.exitCode !== 0 || !result.stdout.trim()) {
		throw new Error(`Could not translate WSL path for Windows: ${path}`);
	}

	return result.stdout.trim();
};

const connectLocalExpoAndroid = (
	adb: string,
	appId: string,
	metroPort: number,
	capture: NonNullable<StartAbsoluteExpoDevOptions['capture']>,
	preferredDevice?: string
) => {
	const devices = capture([adb, 'devices']);
	if (devices.exitCode !== 0)
		throw new Error(
			'Could not inspect devices after the Expo Android build.'
		);
	const ready = devices.stdout.split(/\r?\n/u).flatMap((line) => {
		const match = /^(\S+)\s+device$/u.exec(line.trim());

		return match?.[1] ? [match[1]] : [];
	});
	const serial = preferredDevice
		? ready.find((value) => value === preferredDevice)
		: (ready.find((value) => value.startsWith('emulator-')) ?? ready[0]);
	if (!serial)
		throw new Error(
			preferredDevice
				? 'The selected Expo Android device is not connected after build.'
				: 'Expo Android build completed but no ready device was found.'
		);
	const run = (args: string[], message: string) => {
		if (capture([adb, '-s', serial, ...args]).exitCode !== 0)
			throw new Error(message);
	};
	run(
		['reverse', `tcp:${metroPort}`, `tcp:${metroPort}`],
		'Expo Android Metro forwarding failed.'
	);
	run(
		['shell', 'am', 'force-stop', appId],
		'Expo Android development-client reset failed.'
	);
	run(
		[
			'shell',
			'am',
			'start',
			'-W',
			'-a',
			'android.intent.action.VIEW',
			'-d',
			expoDevelopmentClientUrl(appId, 'localhost', metroPort),
			appId
		],
		'Expo Android development-client launch failed.'
	);

	return serial;
};

const encodedWindowsExpoAndroidCommand = (
	project: string,
	androidRoot: string,
	appId: string,
	args: readonly string[],
	capture: NonNullable<StartAbsoluteExpoDevOptions['capture']>,
	metroPort: number,
	preferredDevice?: string
) => {
	const windowsSource = windowsPathFromWsl(project, capture);
	const buildId = Bun.hash(resolvePath(project)).toString(16);
	const buildDirectory = resolvePath(
		androidRoot,
		'..',
		'..',
		'ExpoBuilds',
		buildId.slice(0, 10)
	);
	const windowsDirectory = windowsPathFromWsl(buildDirectory, capture);
	const windowsAndroidRoot = windowsPathFromWsl(androidRoot, capture);
	const encode = (value: string) =>
		Buffer.from(value, 'utf8').toString('base64');
	const developmentScheme = expoDevelopmentClientScheme(appId);
	const realpathHook = encode(preserveWindowsSubstRealpaths);
	const mappedBuild = [
		"$mappedProject = Join-Path ($drive + '\\') (Split-Path -Leaf $directory)",
		'Set-Location $mappedProject',
		"$hook = Join-Path $mappedProject '.absolutejs-preserve-subst.cjs'",
		`[IO.File]::WriteAllText($hook, [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${realpathHook}')))`,
		'$env:ABSOLUTE_EXPO_PHYSICAL_ROOT = $directory',
		'$env:ABSOLUTE_EXPO_MAPPED_ROOT = $mappedProject',
		'$env:NODE_OPTIONS = "--require=$hook"',
		"$autolinkingCache = Join-Path $mappedProject 'android\\build\\generated\\autolinking'",
		'if ([IO.Directory]::Exists($autolinkingCache)) { [IO.Directory]::Delete($autolinkingCache, $true) }',
		"$expo = Join-Path $mappedProject 'node_modules\\.bin\\expo.exe'",
		'& $expo @expoArguments',
		"if ($LASTEXITCODE -ne 0) { throw 'Expo Android native build failed.' }",
		"$adb = Join-Path $androidHome 'platform-tools\\adb.exe'",
		"$readyDevices = @(& $adb devices) | Where-Object { $_ -match '\\tdevice$' } | ForEach-Object { ($_ -split '\\s+')[0] }",
		...(preferredDevice
			? [
					`$serial = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(preferredDevice)}'))`,
					"if ($readyDevices -notcontains $serial) { throw 'The selected Expo Android device is not connected after build.' }"
				]
			: [
					"$serial = $readyDevices | Where-Object { $_ -like 'emulator-*' } | Select-Object -First 1",
					'if (-not $serial) { $serial = $readyDevices | Select-Object -First 1 }'
				]),
		"if (-not $serial) { throw 'Expo Android build completed but no ready device was found.' }",
		`& $adb -s $serial reverse 'tcp:${metroPort}' 'tcp:${metroPort}'`,
		"if ($LASTEXITCODE -ne 0) { throw 'Expo Android Metro forwarding failed.' }",
		`& $adb -s $serial shell am force-stop '${appId}'`,
		"if ($LASTEXITCODE -ne 0) { throw 'Expo Android development-client reset failed.' }",
		`$developmentUrl = '${developmentScheme}://expo-development-client/?url=' + [Uri]::EscapeDataString('http://localhost:${metroPort}')`,
		`& $adb -s $serial shell am start -W -a android.intent.action.VIEW -d $developmentUrl '${appId}'`,
		"if ($LASTEXITCODE -ne 0) { throw 'Expo Android development-client launch failed.' }"
	].join('; ');
	const source = [
		"$ErrorActionPreference = 'Stop'",
		"$ProgressPreference = 'SilentlyContinue'",
		`$source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(windowsSource)}'))`,
		`$directory = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(windowsDirectory)}'))`,
		`$androidHome = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(windowsAndroidRoot)}'))`,
		`$expoArguments = @([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(JSON.stringify(args))}')) | ConvertFrom-Json)`,
		'$env:ANDROID_HOME = $androidHome',
		'$env:ANDROID_SDK_ROOT = $androidHome',
		"$env:NODE_ENV = 'development'",
		...(preferredDevice
			? []
			: ["$env:ORG_GRADLE_PROJECT_reactNativeArchitectures = 'x86_64'"]),
		'New-Item -ItemType Directory -Force -Path $directory | Out-Null',
		'& robocopy.exe $source $directory /MIR /XD node_modules .expo .git .gradle .cxx .kotlin build /XF bun.lock bun.lockb .absolutejs-preserve-subst.cjs /NFL /NDL /NJH /NJS /NP',
		'$copyExit = $LASTEXITCODE',
		'if ($copyExit -ge 8) { exit $copyExit }',
		'Set-Location $directory',
		'$bun = (Get-Command bun.exe -ErrorAction Stop).Source',
		'& $bun install',
		'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
		"$drive = @('Z:', 'Y:', 'X:', 'W:', 'V:', 'U:', 'T:') | Where-Object { -not (Test-Path ($_ + '\\')) } | Select-Object -First 1",
		"if (-not $drive) { throw 'AbsoluteJS could not reserve a temporary drive letter for the Expo Android build.' }",
		'$mirrorRoot = Split-Path -Parent $directory',
		'& subst.exe $drive $mirrorRoot',
		"if ($LASTEXITCODE -ne 0) { throw 'AbsoluteJS could not create the short Expo Android build path.' }",
		`try { ${mappedBuild} } finally { Set-Location ($env:SystemDrive + '\\'); & subst.exe $drive /D | Out-Null }`,
		'exit 0'
	].join('; ');

	return [
		'powershell.exe',
		'-NoProfile',
		'-EncodedCommand',
		Buffer.from(source, 'utf16le').toString('base64')
	];
};

const commandEnvironment = (options: PlanAbsoluteExpoDevOptions) => ({
	ABSOLUTE_EXPO_DEVELOPMENT: '1',
	NODE_ENV: 'development',
	...(options.certificateAuthorityPath
		? {
				ABSOLUTE_EXPO_DEVELOPMENT_CA_PATH:
					options.certificateAuthorityPath
			}
		: {}),
	...(options.androidOrigin
		? { EXPO_PUBLIC_ABSOLUTE_DEV_ANDROID_ORIGIN: options.androidOrigin }
		: {}),
	...(options.iosOrigin
		? { EXPO_PUBLIC_ABSOLUTE_DEV_IOS_ORIGIN: options.iosOrigin }
		: {}),
	...(options.metroHost
		? { REACT_NATIVE_PACKAGER_HOSTNAME: options.metroHost }
		: {})
});

export const absoluteExpoExecutable = async (project: string) => {
	const executable = join(project, 'node_modules', '.bin', 'expo');
	try {
		await access(executable);

		return executable;
	} catch {
		throw new TypeError(
			'Expo dependencies are not installed in the generated shell. Run `absolute mobile init --yes`.'
		);
	}
};

export const planAbsoluteExpoDevSession = (
	config: NormalizedAbsoluteMobileConfig,
	options: PlanAbsoluteExpoDevOptions
): AbsoluteExpoDevPlan => {
	if (config.engine !== 'expo')
		throw new TypeError('The Expo development controller requires Expo.');
	if (options.platforms.length === 0 && options.metro === 'external')
		throw new TypeError(
			'External Expo execution requires a target platform.'
		);
	const secureOrigin = [options.androidOrigin, options.iosOrigin].some(
		(origin) => origin && new URL(origin).protocol === 'https:'
	);
	if (secureOrigin && !options.certificateAuthorityPath)
		throw new TypeError(
			'Expo HTTPS development requires the AbsoluteJS development CA certificate.'
		);
	const env = commandEnvironment(options);
	const metro: AbsoluteExpoDevCommand = {
		args: [
			'start',
			'--dev-client',
			'--host',
			'localhost',
			'--port',
			String(options.metroPort)
		],
		env,
		role: 'metro'
	};
	const prepare: AbsoluteExpoDevCommand | undefined =
		options.platforms.length === 0
			? undefined
			: {
					args: [
						'prebuild',
						'--clean',
						'--no-install',
						'--platform',
						options.platforms.length === 2
							? 'all'
							: (options.platforms[0] ?? 'all')
					],
					env,
					role: 'native-prepare'
				};
	const native = options.platforms.map((platform) => {
		const device =
			platform === 'android' ? options.androidDevice : options.iosDevice;
		const command: AbsoluteExpoDevCommand = {
			args: [
				`run:${platform}`,
				'--no-bundler',
				...(device ? ['--device', device] : [])
			],
			env,
			platform,
			role: 'native-build'
		};

		return command;
	});

	return {
		commands: [
			...(prepare ? [prepare] : []),
			...(options.metro === 'external' ? [] : [metro]),
			...native
		],
		metroPort: options.metroPort,
		project: config.nativeProjectDirectory
	};
};

const abortError = () =>
	new DOMException('Expo development aborted.', 'AbortError');

const forwardLines = (
	process: ChildProcess,
	onLine: (line: string) => void
) => {
	const attach = (stream: NodeJS.ReadableStream | null) => {
		if (!stream) return;
		let buffered = '';
		stream.on('data', (chunk: Buffer) => {
			buffered += chunk.toString('utf8');
			let newline = buffered.indexOf('\n');
			while (newline >= 0) {
				onLine(buffered.slice(0, newline).replace(/\r$/u, ''));
				buffered = buffered.slice(newline + 1);
				newline = buffered.indexOf('\n');
			}
		});
		stream.on('end', () => {
			if (buffered) onLine(buffered);
		});
	};
	attach(process.stdout);
	attach(process.stderr);
};

const stopProcess = async (process: ChildProcess) => {
	if (process.exitCode !== null || process.killed) return;
	process.kill('SIGTERM');
	await Promise.race([
		new Promise<void>((resolve) => process.once('exit', () => resolve())),
		new Promise<void>((resolve) =>
			setTimeout(resolve, PROCESS_CLOSE_TIMEOUT_MS)
		)
	]);
	if (process.exitCode === null) process.kill('SIGKILL');
};

const waitForExit = (process: ChildProcess) =>
	new Promise<number>((resolve) => {
		if (process.exitCode !== null) {
			resolve(process.exitCode);

			return;
		}
		process.once('exit', (code) => resolve(code ?? 1));
	});

type ExpoUtilityCommandOptions = {
	cwd: string;
	signal?: AbortSignal;
	log: (message: string) => void;
};

const runUtilityCommand = async (
	run: typeof spawn,
	command: string,
	args: string[],
	options: ExpoUtilityCommandOptions
) => {
	const child = run(command, args, {
		cwd: options.cwd,
		env: process.env,
		stdio: ['ignore', 'pipe', 'pipe']
	});
	forwardLines(child, options.log);
	const abort = () => void stopProcess(child);
	options.signal?.addEventListener('abort', abort, { once: true });
	const exitCode = await waitForExit(child);
	options.signal?.removeEventListener('abort', abort);
	if (options.signal?.aborted) throw abortError();

	return exitCode;
};

export const startAbsoluteExpoDevSession = async (
	options: StartAbsoluteExpoDevOptions
) => {
	const plan = planAbsoluteExpoDevSession(options.config, options);
	const executable =
		options.executable ?? (await absoluteExpoExecutable(plan.project));
	const run = options.spawnProcess ?? spawn;
	const host = options.host ?? detectAbsoluteMobileHost();
	const capture = options.capture ?? captureCommand;
	const log = options.log ?? (() => undefined);
	const timings: Partial<Record<AbsoluteExpoDevState, number>> = {};
	let caEnrollmentServer: AbsoluteIosCaEnrollmentServer | null = null;
	const closeEnrollmentServer = async () => {
		const server = caEnrollmentServer;
		caEnrollmentServer = null;
		await server?.close();
	};
	const publishTiming = (phase: AbsoluteExpoDevState, durationMs: number) => {
		timings[phase] = (timings[phase] ?? 0) + durationMs;
		options.onPhaseTiming?.({ durationMs, phase });
	};
	const setState = (state: AbsoluteExpoDevState) => {
		options.onStateChange?.(state);
	};
	if (options.signal?.aborted) throw abortError();
	const prepareCommand = plan.commands.find(
		(command) => command.role === 'native-prepare'
	);
	const metroCommand = plan.commands.find(
		(command) => command.role === 'metro'
	);
	const nativeCommands = plan.commands.filter(
		(command) => command.role === 'native-build'
	);
	const runPrepareCommand = async (command: AbsoluteExpoDevCommand) => {
		setState('preparing-native');
		const prepareStarted = performance.now();
		const prepareProcess = run(executable, command.args, {
			cwd: plan.project,
			env: { ...process.env, ...command.env },
			stdio: ['ignore', 'pipe', 'pipe']
		});
		forwardLines(prepareProcess, (line) => {
			if (line) log(`[prebuild] ${line}`);
		});
		const abortPrepare = () => void stopProcess(prepareProcess);
		options.signal?.addEventListener('abort', abortPrepare, { once: true });
		const prepareExit = await waitForExit(prepareProcess);
		options.signal?.removeEventListener('abort', abortPrepare);
		if (options.signal?.aborted) throw abortError();
		if (prepareExit !== 0) {
			setState('failed');
			throw new Error(
				`Expo native preparation exited with status ${prepareExit}.`
			);
		}
		publishTiming('preparing-native', performance.now() - prepareStarted);
	};
	if (prepareCommand) await runPrepareCommand(prepareCommand);
	const managedMetro = metroCommand !== undefined;
	if (managedMetro) setState('starting-metro');
	const metroStarted = performance.now();
	const metro = metroCommand
		? run(executable, metroCommand.args, {
				cwd: plan.project,
				env: { ...process.env, ...metroCommand.env },
				stdio: ['ignore', 'pipe', 'pipe']
			})
		: undefined;
	let metroReady = false;
	let resolveMetro: (() => void) | undefined;
	const metroPromise = new Promise<void>((resolve, reject) => {
		if (!metro) {
			resolve();

			return;
		}
		const timeout = setTimeout(() => {
			reject(
				new Error('Expo Metro did not become ready within 60 seconds.')
			);
		}, METRO_READY_TIMEOUT_MS);
		resolveMetro = () => {
			clearTimeout(timeout);
			resolve();
		};
		metro.once('exit', (code) => {
			if (!metroReady) {
				clearTimeout(timeout);
				reject(
					new Error(`Expo Metro exited with status ${code ?? 1}.`)
				);
			}
		});
	});
	if (metro)
		forwardLines(metro, (line) => {
			if (line) log(`[metro] ${line}`);
			if (
				!metroReady &&
				/(?:Waiting on|Metro waiting on|Dev server ready)/iu.test(line)
			) {
				metroReady = true;
				resolveMetro?.();
			}
		});
	const abort = () => {
		if (metro) void stopProcess(metro);
	};
	options.signal?.addEventListener('abort', abort, { once: true });
	const runNativeCommand = async (command: AbsoluteExpoDevCommand) => {
		if (options.signal?.aborted) throw abortError();
		const { platform } = command;
		if (!platform)
			throw new TypeError(
				'Expo native build command is missing a platform.'
			);
		const state: AbsoluteExpoDevState =
			platform === 'android' ? 'building-android' : 'building-ios';
		setState(state);
		const started = performance.now();
		const invocation =
			platform === 'android' && host === 'wsl'
				? encodedWindowsExpoAndroidCommand(
						plan.project,
						options.androidRoot ??
							absoluteManagedAndroidSdkRoot(host),
						options.config.appId,
						command.args,
						capture,
						options.metroPort,
						options.androidDevice
					)
				: [executable, ...command.args];
		if (platform === 'android' && host === 'wsl') {
			log(
				'[android] Mirroring native inputs to the Windows host for accelerated Expo build and launch.'
			);
		}
		const [nativeExecutable, ...nativeArguments] = invocation;
		if (!nativeExecutable)
			throw new Error('Expo native build command is empty.');
		const child = run(nativeExecutable, nativeArguments, {
			cwd: plan.project,
			env: { ...process.env, ...command.env },
			stdio: ['ignore', 'pipe', 'pipe']
		});
		forwardLines(child, (line) => {
			if (line) log(`[${platform}] ${line}`);
		});
		const abortChild = () => void stopProcess(child);
		options.signal?.addEventListener('abort', abortChild, { once: true });
		const exitCode = await waitForExit(child);
		options.signal?.removeEventListener('abort', abortChild);
		if (options.signal?.aborted) throw abortError();
		if (exitCode !== 0) {
			throw new Error(
				`Expo ${platform} development build exited with status ${exitCode}.`
			);
		}
		if (platform === 'android' && host !== 'wsl') {
			const androidRoot =
				options.androidRoot ??
				process.env.ANDROID_HOME ??
				process.env.ANDROID_SDK_ROOT ??
				absoluteManagedAndroidSdkRoot(host);
			const adb =
				options.androidAdb ??
				join(
					androidRoot,
					'platform-tools',
					host === 'windows' ? 'adb.exe' : 'adb'
				);
			connectLocalExpoAndroid(
				adb,
				options.config.appId,
				options.metroPort,
				capture,
				options.androidDevice
			);
			log('Connected the Expo Android development client to Metro.');
		}
		if (
			platform === 'ios' &&
			options.certificateAuthorityPath &&
			options.iosOrigin &&
			new URL(options.iosOrigin).protocol === 'https:' &&
			!options.iosDevice
		) {
			setState('enrolling-trust');
			const trustStarted = performance.now();
			const utilityOptions: ExpoUtilityCommandOptions = {
				cwd: plan.project,
				signal: options.signal,
				log: (line: string) => line && log(`[ios-trust] ${line}`)
			};
			const trustExit = await runUtilityCommand(
				run,
				'xcrun',
				[
					'simctl',
					'keychain',
					'booted',
					'add-root-cert',
					options.certificateAuthorityPath
				],
				utilityOptions
			);
			if (trustExit !== 0)
				throw new Error(
					`Expo iOS Simulator development CA trust exited with status ${trustExit}.`
				);
			await runUtilityCommand(
				run,
				'xcrun',
				['simctl', 'terminate', 'booted', options.config.appId],
				utilityOptions
			);
			const launchExit = await runUtilityCommand(
				run,
				'xcrun',
				['simctl', 'launch', 'booted', options.config.appId],
				utilityOptions
			);
			if (launchExit !== 0)
				throw new Error(
					`Expo iOS Simulator relaunch exited with status ${launchExit}.`
				);
			log(
				'Installed the AbsoluteJS development CA into the Expo iOS Simulator and relaunched the app.'
			);
			publishTiming('enrolling-trust', performance.now() - trustStarted);
		}
		if (platform === 'ios' && !options.iosDevice) {
			const utilityOptions: ExpoUtilityCommandOptions = {
				cwd: plan.project,
				signal: options.signal,
				log: (line: string) => line && log(`[ios-connect] ${line}`)
			};
			await runUtilityCommand(
				run,
				'xcrun',
				['simctl', 'terminate', 'booted', options.config.appId],
				utilityOptions
			);
			const connectExit = await runUtilityCommand(
				run,
				'xcrun',
				[
					'simctl',
					'openurl',
					'booted',
					expoDevelopmentClientUrl(
						options.config.appId,
						options.metroHost ?? 'localhost',
						options.metroPort
					)
				],
				utilityOptions
			);
			if (connectExit !== 0)
				throw new Error(
					`Expo iOS Simulator Metro connection exited with status ${connectExit}.`
				);
			log(
				'Connected the Expo iOS Simulator development client to Metro.'
			);
		}
		const durationMs = performance.now() - started;
		timings[state] = durationMs;
		options.onPhaseTiming?.({ durationMs, phase: state });
	};
	const runNativeCommands = async (
		commands: AbsoluteExpoDevCommand[]
	): Promise<void> => {
		const [command, ...remaining] = commands;
		if (!command) return;
		await runNativeCommand(command);
		await runNativeCommands(remaining);
	};
	const startPhysicalIosEnrollment = async () => {
		if (
			!options.iosDevice ||
			!options.certificateAuthorityPath ||
			!options.iosOrigin ||
			new URL(options.iosOrigin).protocol !== 'https:'
		) {
			return;
		}
		setState('enrolling-trust');
		const trustStarted = performance.now();
		const startEnrollment =
			options.startCaEnrollmentServer ??
			startAbsoluteIosCaEnrollmentServer;
		caEnrollmentServer = await startEnrollment({
			certificateAuthorityPath: options.certificateAuthorityPath,
			displayHost: new URL(options.iosOrigin).hostname
		});
		log(
			`On the iOS device, open ${caEnrollmentServer.url}, install the AbsoluteJS development CA profile, then enable it under Settings > General > About > Certificate Trust Settings. This public CA endpoint exists only for this dev session.`
		);
		publishTiming('enrolling-trust', performance.now() - trustStarted);
	};
	try {
		await startPhysicalIosEnrollment();
		await metroPromise;
		if (managedMetro)
			publishTiming('starting-metro', performance.now() - metroStarted);
		await runNativeCommands(nativeCommands);
		setState('ready');

		return {
			metroPort: plan.metroPort,
			platforms: options.platforms,
			timings,
			close: async () => {
				options.signal?.removeEventListener('abort', abort);
				if (metro) await stopProcess(metro);
				await closeEnrollmentServer();
				setState('closed');
			}
		};
	} catch (error) {
		options.signal?.removeEventListener('abort', abort);
		if (metro) await stopProcess(metro);
		await closeEnrollmentServer();
		setState('failed');
		throw error;
	}
};
