import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	parseAdbDevices,
	repairAbsoluteAndroidDevSession,
	startAbsoluteAndroidDevSession,
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

	return { nativeConfigPath, originalConfig, project };
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

	return { exitCode: 0, stderr: '', stdout: '' };
};

describe('Android emulator development controller', () => {
	test('only selects ADB devices that are ready', () => {
		expect(
			parseAdbDevices(
				'List of devices attached\nemulator-5554\tdevice\nemulator-5556\toffline\nphone\tunauthorized\n'
			)
		).toEqual(['emulator-5554']);
	});

	test('connects an existing managed emulator and restores native config', async () => {
		const { nativeConfigPath, originalConfig, project } =
			await createProject();
		const commands: string[][] = [];
		const session = await startAbsoluteAndroidDevSession({
			capture: readyCapture,
			port: 3030,
			project,
			run: async (command) => {
				commands.push(command);

				return 0;
			}
		});
		const developmentConfig = JSON.parse(
			await readFile(nativeConfigPath, 'utf8')
		);

		expect(session.startedEmulator).toBe(false);
		expect(developmentConfig.server).toEqual({
			allowNavigation: ['api.example.com'],
			cleartext: true,
			url: 'http://localhost:3030'
		});
		expect(commands.some((command) => command.includes('reverse'))).toBe(
			true
		);
		expect(commands.some((command) => command.includes('install'))).toBe(
			true
		);
		expect(commands.some((command) => command.includes('monkey'))).toBe(
			true
		);

		await session.close();

		expect(await readFile(nativeConfigPath, 'utf8')).toBe(originalConfig);
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

		expect(commands.some(([command]) => command === 'powershell.exe')).toBe(
			true
		);
		const install = commands.find((command) => command.includes('install'));
		expect(install?.at(-1)?.startsWith('C:\\absolute')).toBe(true);

		await session.close();
	});

	test('restores production-safe native config when startup fails', async () => {
		const { nativeConfigPath, originalConfig, project } =
			await createProject();
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
		expect(commands.some((command) => command.includes('--remove'))).toBe(
			true
		);
		expect(await repairAbsoluteAndroidDevSession(project.projectRoot)).toBe(
			false
		);
	});
});
