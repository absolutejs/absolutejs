import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	parseAdbDevices,
	parseAbsoluteAndroidLogLine,
	redactAbsoluteAndroidLog,
	repairAbsoluteAndroidDevSession,
	fingerprintAbsoluteAndroidNativeProject,
	startAbsoluteAndroidDevSession,
	type AbsoluteAndroidDevState,
	type AbsoluteAndroidNativeLogEntry,
	type AbsoluteAndroidDevProject
} from '../../../src/mobile/androidEmulatorController';
import { normalizeAbsoluteMobileConfig } from '../../../src/mobile/config';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});

const createProject = async (host: 'linux' | 'wsl' = 'linux') => {
	const projectRoot = await mkdtemp(join(tmpdir(), 'absolute-android-dev-'));
	temporaryDirectories.push(projectRoot);
	const config = normalizeAbsoluteMobileConfig(
		{
			appId: 'com.example.product',
			appName: 'Product',
			entry: '/account/Ada',
			platforms: ['android'],
			server: { productionOrigin: 'https://api.example.com' }
		},
		projectRoot
	);
	const nativeDirectory = join(config.nativeProjectDirectory, 'android');
	const nativeConfigPath = join(
		nativeDirectory,
		'app',
		'src',
		'main',
		'assets',
		'capacitor.config.json'
	);
	await mkdir(join(nativeDirectory, 'app', 'src', 'main', 'assets'), {
		recursive: true
	});
	await mkdir(
		join(nativeDirectory, 'app', 'build', 'outputs', 'apk', 'debug'),
		{
			recursive: true
		}
	);
	await writeFile(
		join(nativeDirectory, 'capacitor.settings.gradle'),
		"include ':capacitor-android'\nproject(':capacitor-android').projectDir = new File('../../node_modules/@capacitor/android/capacitor')\n"
	);
	await mkdir(
		join(
			nativeDirectory,
			'..',
			'..',
			'node_modules',
			'@capacitor',
			'android',
			'capacitor',
			'src',
			'main'
		),
		{ recursive: true }
	);
	await writeFile(
		join(
			nativeDirectory,
			'..',
			'..',
			'node_modules',
			'@capacitor',
			'android',
			'capacitor',
			'build.gradle'
		),
		'plugins { id "com.android.library" }\n'
	);
	await writeFile(
		join(nativeDirectory, 'app', 'build.gradle'),
		'plugins { id "com.android.application" }\n'
	);
	const nativeManifestPath = join(
		nativeDirectory,
		'app',
		'src',
		'main',
		'AndroidManifest.xml'
	);
	const originalManifest =
		'<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:label="Product" /></manifest>\n';
	await writeFile(nativeManifestPath, originalManifest);
	const originalConfig = `${JSON.stringify({ appId: config.appId, server: { allowNavigation: ['api.example.com'] } }, null, '\t')}\n`;
	await writeFile(nativeConfigPath, originalConfig);
	const project: AbsoluteAndroidDevProject = {
		adb: host === 'wsl' ? 'adb.exe' : '/sdk/platform-tools/adb',
		androidRoot: host === 'wsl' ? '/mnt/c/Android/sdk' : '/sdk',
		cap: join(projectRoot, 'node_modules', '.bin', 'cap'),
		config,
		emulator: host === 'wsl' ? 'emulator.exe' : '/sdk/emulator/emulator',
		host,
		nativeDirectory,
		projectRoot
	};

	return {
		nativeConfigPath,
		nativeManifestPath,
		originalConfig,
		originalManifest,
		project
	};
};

const readyCapture = (command: string[]) => {
	if (command[0] === 'wslpath') {
		return {
			exitCode: 0,
			stderr: '',
			stdout: `C:\\absolute${command.at(-1)?.replaceAll('/', '\\')}\n`
		};
	}
	if (command.includes('devices')) {
		return {
			exitCode: 0,
			stderr: '',
			stdout: 'List of devices attached\nemulator-5554\tdevice\n'
		};
	}
	if (command.includes('getprop')) {
		return { exitCode: 0, stderr: '', stdout: '1\n' };
	}
	if (command.includes('avd')) {
		return { exitCode: 0, stderr: '', stdout: 'AbsoluteJS_API_36\nOK\n' };
	}
	if (command.includes('packages')) {
		return {
			exitCode: 0,
			stderr: '',
			stdout: 'package:com.example.product uid:10123\n'
		};
	}
	if (command.includes('dumpsys')) {
		return {
			exitCode: 0,
			stderr: '',
			stdout: 'Package [com.example.product]\n  codePath=/data/app/absolute/product\n  lastUpdateTime=2026-08-20 12:00:00\n'
		};
	}

	return { exitCode: 0, stderr: '', stdout: '' };
};

describe('Android emulator development controller', () => {
	test('fingerprints native inputs while excluding the live web bundle', async () => {
		const { project } = await createProject();
		const initial = await fingerprintAbsoluteAndroidNativeProject(project);
		const publicDirectory = join(
			project.nativeDirectory,
			'app',
			'src',
			'main',
			'assets',
			'public'
		);
		await mkdir(publicDirectory, { recursive: true });
		await writeFile(join(publicDirectory, 'page.js'), 'web change\n');
		expect(await fingerprintAbsoluteAndroidNativeProject(project)).toBe(
			initial
		);
		await writeFile(
			join(project.nativeDirectory, 'app', 'build.gradle'),
			'plugins { id "com.android.application" }\n// native change\n'
		);
		expect(await fingerprintAbsoluteAndroidNativeProject(project)).not.toBe(
			initial
		);
	});

	test('invalidates when a resolved Capacitor native dependency changes', async () => {
		const { project } = await createProject();
		const initial = await fingerprintAbsoluteAndroidNativeProject(project);
		await writeFile(
			join(
				project.nativeDirectory,
				'..',
				'..',
				'node_modules',
				'@capacitor',
				'android',
				'capacitor',
				'src',
				'main',
				'Bridge.java'
			),
			'class Bridge {}\n'
		);
		expect(await fingerprintAbsoluteAndroidNativeProject(project)).not.toBe(
			initial
		);
	});

	test('skips Gradle and installation only for the matching installed native app', async () => {
		const { project } = await createProject();
		const firstCommands: string[][] = [];
		const first = await startAbsoluteAndroidDevSession({
			capture: readyCapture,
			port: 3029,
			project,
			run: async (command) => {
				firstCommands.push(command);

				return 0;
			}
		});
		await first.close();
		expect(
			firstCommands.some((command) => command.includes('install'))
		).toBe(true);
		const publicDirectory = join(
			project.nativeDirectory,
			'app',
			'src',
			'main',
			'assets',
			'public'
		);
		await mkdir(publicDirectory, { recursive: true });
		await writeFile(join(publicDirectory, 'hmr.js'), 'web-only edit\n');

		const cachedCommands: string[][] = [];
		const logs: string[] = [];
		const cached = await startAbsoluteAndroidDevSession({
			capture: readyCapture,
			port: 3029,
			project,
			log: (message) => logs.push(message),
			run: async (command) => {
				cachedCommands.push(command);

				return 0;
			}
		});
		expect(
			cachedCommands.some((command) => command.includes('install'))
		).toBe(false);
		expect(cached.nativeCacheHit).toBe(true);
		expect(cached.timings.building).toBeUndefined();
		expect(
			cachedCommands.some((command) => command.includes('assembleDebug'))
		).toBe(false);
		expect(logs.some((message) => message.includes('skipped Gradle'))).toBe(
			true
		);
		await cached.close();
		const transportCommands: string[][] = [];
		const changedTransport = await startAbsoluteAndroidDevSession({
			capture: readyCapture,
			port: 3030,
			project,
			run: async (command) => {
				transportCommands.push(command);

				return 0;
			}
		});
		expect(
			transportCommands.some((command) => command.includes('install'))
		).toBe(true);
		await changedTransport.close();

		await writeFile(
			join(project.nativeDirectory, 'app', 'build.gradle'),
			'plugins { id "com.android.application" }\n// changed\n'
		);
		const changedCommands: string[][] = [];
		const changed = await startAbsoluteAndroidDevSession({
			capture: readyCapture,
			port: 3030,
			project,
			run: async (command) => {
				changedCommands.push(command);

				return 0;
			}
		});
		expect(
			changedCommands.some((command) => command.includes('install'))
		).toBe(true);
		await changed.close();
	});

	test('rebuilds when the package was replaced outside AbsoluteJS', async () => {
		const { project } = await createProject();
		let installedIdentity = 'first';
		const capture = (command: string[]) => {
			if (!command.includes('dumpsys')) return readyCapture(command);

			return {
				exitCode: 0,
				stderr: '',
				stdout: `codePath=/data/app/${installedIdentity}\nlastUpdateTime=${installedIdentity}\n`
			};
		};
		const first = await startAbsoluteAndroidDevSession({
			capture,
			port: 3028,
			project,
			run: async () => 0
		});
		await first.close();
		installedIdentity = 'replacement';
		const commands: string[][] = [];
		const replacement = await startAbsoluteAndroidDevSession({
			capture,
			port: 3028,
			project,
			run: async (command) => {
				commands.push(command);

				return 0;
			}
		});
		expect(commands.some((command) => command.includes('install'))).toBe(
			true
		);
		await replacement.close();
	});
	test('categorizes logcat lines and redacts auth material', () => {
		expect(
			parseAbsoluteAndroidLogLine(
				'08-20 12:34:56.789 123 456 W Capacitor/Console: Authorization: Bearer secret-token'
			)
		).toEqual({
			level: 'warn',
			message: 'Authorization: [REDACTED]',
			tag: 'Capacitor/Console'
		});
		expect(
			redactAbsoluteAndroidLog(
				'https://example.test/callback?code=secret&token=also-secret "access_token":"third-secret"'
			)
		).toBe(
			'https://example.test/callback?code=[REDACTED]&token=[REDACTED] "access_token":[REDACTED]'
		);
		expect(
			redactAbsoluteAndroidLog(
				'Cookie: session=secret; refresh=also-secret'
			)
		).toBe('Cookie: [REDACTED]');
	});

	test('only selects ADB devices that are ready', () => {
		expect(
			parseAdbDevices(
				'List of devices attached\nemulator-5554\tdevice\nemulator-5556\toffline\nphone\tunauthorized\n'
			)
		).toEqual(['emulator-5554']);
	});

	test('connects an existing managed emulator and restores native config', async () => {
		const {
			nativeConfigPath,
			nativeManifestPath,
			originalConfig,
			originalManifest,
			project
		} = await createProject();
		const commands: string[][] = [];
		const logCommands: string[][] = [];
		const logEntries: AbsoluteAndroidNativeLogEntry[] = [];
		const states: AbsoluteAndroidDevState[] = [];
		let logStreamClosed = false;
		const session = await startAbsoluteAndroidDevSession({
			capture: readyCapture,
			port: 3030,
			project,
			nativeLog: (entry) => logEntries.push(entry),
			onStateChange: (state) => states.push(state),
			run: async (command) => {
				commands.push(command);

				return 0;
			},
			startNativeLogs: (command, _options, onLine) => {
				logCommands.push(command);
				onLine(
					'08-20 12:34:56.789 123 456 I Capacitor/Console: access_token=secret'
				);

				return {
					close: async () => {
						logStreamClosed = true;
					}
				};
			}
		});
		const developmentConfig = JSON.parse(
			await readFile(nativeConfigPath, 'utf8')
		);

		expect(session.startedEmulator).toBe(false);
		expect(session.nativeCacheHit).toBe(false);
		expect(session.state).toBe('ready');
		expect(session.timings.total).toBeGreaterThan(0);
		expect(session.timings.syncing).toBeGreaterThanOrEqual(0);
		expect(states).toContain('building');
		expect(states).toContain('streaming-logs');
		expect(logCommands[0]).toContain('--uid=10123');
		expect(logCommands[0]).toContain('*:W');
		expect(logCommands[0]).toContain('Capacitor/Console:V');
		expect(logEntries).toEqual([
			{
				level: 'info',
				message: 'access_token=[REDACTED]',
				tag: 'Capacitor/Console'
			}
		]);
		expect(developmentConfig.server).toEqual({
			allowNavigation: ['api.example.com'],
			cleartext: true,
			url: 'http://localhost:3030/account/Ada?__absolute_target=capacitor-android'
		});
		expect(await readFile(nativeManifestPath, 'utf8')).toContain(
			'android:usesCleartextTraffic="true"'
		);
		expect(commands.some((command) => command.includes('reverse'))).toBe(
			true
		);
		expect(commands.some((command) => command.includes('install'))).toBe(
			true
		);
		expect(commands.some((command) => command.includes('monkey'))).toBe(
			true
		);
		await session.relaunch();
		expect(
			commands.filter((command) => command.includes('monkey')).length
		).toBe(2);

		await session.close();

		expect(session.state).toBe('closed');
		expect(logStreamClosed).toBe(true);
		expect(await readFile(nativeConfigPath, 'utf8')).toBe(originalConfig);
		expect(await readFile(nativeManifestPath, 'utf8')).toBe(
			originalManifest
		);
		expect(await repairAbsoluteAndroidDevSession(project.projectRoot)).toBe(
			false
		);
	});

	test('uses Windows Gradle and APK paths when developing through WSL', async () => {
		const { project } = await createProject('wsl');
		const commands: string[][] = [];
		const session = await startAbsoluteAndroidDevSession({
			capture: readyCapture,
			port: 3031,
			project,
			run: async (command) => {
				commands.push(command);

				return 0;
			}
		});

		const powershell = commands.find(
			([command]) => command === 'powershell.exe'
		);
		expect(powershell?.slice(0, 3)).toEqual([
			'powershell.exe',
			'-NoProfile',
			'-EncodedCommand'
		]);
		const encodedCommand = powershell?.at(-1);
		expect(encodedCommand).toBeString();
		const decodedCommand = Buffer.from(
			encodedCommand ?? '',
			'base64'
		).toString('utf16le');
		expect(decodedCommand).toContain("$ErrorActionPreference = 'Stop'");
		expect(decodedCommand).toContain('robocopy.exe');
		expect(decodedCommand).toContain(
			'/MIR /XD .gradle build .absolutejs-dependencies'
		);
		expect(decodedCommand).toContain('$env:ANDROID_HOME = $androidHome');
		expect(decodedCommand).toContain('.absolutejs-dependencies');
		expect(decodedCommand).toContain('capacitor.settings.gradle');
		expect(decodedCommand).toContain("Join-Path $directory 'gradlew.bat'");
		expect(decodedCommand).toContain(
			'--no-daemon --console=plain -p $directory assembleDebug'
		);
		const install = commands.find((command) => command.includes('install'));
		expect(install?.at(-1)?.startsWith('C:\\absolute')).toBe(true);

		await session.close();
	});

	test('restores production-safe native config when startup fails', async () => {
		const {
			nativeConfigPath,
			nativeManifestPath,
			originalConfig,
			originalManifest,
			project
		} = await createProject();
		const commands: string[][] = [];

		await expect(
			startAbsoluteAndroidDevSession({
				capture: readyCapture,
				port: 3032,
				project,
				run: async (command) => {
					commands.push(command);

					return command.includes('install') ? 1 : 0;
				}
			})
		).rejects.toThrow('Android app installation failed');
		expect(await readFile(nativeConfigPath, 'utf8')).toBe(originalConfig);
		expect(await readFile(nativeManifestPath, 'utf8')).toBe(
			originalManifest
		);
		expect(commands.some((command) => command.includes('--remove'))).toBe(
			true
		);
		expect(await repairAbsoluteAndroidDevSession(project.projectRoot)).toBe(
			false
		);
	});
});
