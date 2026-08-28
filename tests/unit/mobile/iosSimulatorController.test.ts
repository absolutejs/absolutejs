import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	fingerprintAbsoluteIosDevProject,
	parseAbsoluteIosLogLine,
	parseIosDeviceTypes,
	parseIosRuntimes,
	parseIosSimulators,
	redactAbsoluteIosLog,
	repairAbsoluteIosDevSession,
	startAbsoluteIosDevSession,
	type AbsoluteIosCommandResult,
	type AbsoluteIosDevProject
} from '../../../src/mobile/iosSimulatorController';
import { normalizeAbsoluteMobileConfig } from '../../../src/mobile/config';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});

const fixture = async () => {
	const projectRoot = await mkdtemp(join(tmpdir(), 'absolute-ios-dev-'));
	temporaryDirectories.push(projectRoot);
	const config = normalizeAbsoluteMobileConfig(
		{
			appId: 'com.example.product',
			appName: 'Product',
			entry: '/account/Ada',
			platforms: ['ios'],
			server: { productionOrigin: 'https://api.example.com' }
		},
		projectRoot
	);
	const nativeDirectory = join(config.nativeProjectDirectory, 'ios');
	const appDirectory = join(nativeDirectory, 'App', 'App');
	await mkdir(join(nativeDirectory, 'App', 'App.xcworkspace'), {
		recursive: true
	});
	await mkdir(join(appDirectory, 'public'), { recursive: true });
	const nativeConfigPath = join(appDirectory, 'capacitor.config.json');
	const infoPath = join(appDirectory, 'Info.plist');
	const originalConfig = `${JSON.stringify({ appId: config.appId }, null, '\t')}\n`;
	const originalInfo =
		'<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleName</key><string>App</string></dict></plist>\n';
	await Promise.all([
		writeFile(nativeConfigPath, originalConfig),
		writeFile(infoPath, originalInfo),
		writeFile(join(appDirectory, 'AppDelegate.swift'), 'import UIKit\n'),
		writeFile(join(appDirectory, 'public', 'page.js'), 'web one\n')
	]);
	const project: AbsoluteIosDevProject = {
		cap: join(projectRoot, 'node_modules', '.bin', 'cap'),
		config,
		nativeDirectory,
		projectRoot,
		xcodebuild: '/usr/bin/xcodebuild',
		xcrun: '/usr/bin/xcrun'
	};

	return {
		infoPath,
		nativeConfigPath,
		originalConfig,
		originalInfo,
		project
	};
};

const inventory = JSON.stringify({
	devices: {
		'com.apple.CoreSimulator.SimRuntime.iOS-18-5': [
			{
				isAvailable: true,
				name: 'AbsoluteJS iPhone',
				state: 'Booted',
				udid: 'IOS-UDID-1'
			}
		]
	}
});

const runtimes = JSON.stringify({
	runtimes: [
		{
			identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-18-5',
			isAvailable: true,
			name: 'iOS 18.5',
			version: '18.5'
		}
	]
});

describe('iOS simulator development controller', () => {
	test('parses stable simctl runtime, device type, and device identities', () => {
		expect(parseIosRuntimes(runtimes)[0]?.version).toBe('18.5');
		expect(
			parseIosDeviceTypes(
				JSON.stringify({
					devicetypes: [
						{
							identifier:
								'com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro',
							name: 'iPhone 16 Pro'
						}
					]
				})
			)[0]?.identifier
		).toContain('iPhone-16-Pro');
		expect(parseIosSimulators(inventory)[0]).toMatchObject({
			runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-18-5',
			state: 'Booted',
			udid: 'IOS-UDID-1'
		});
	});

	test('fingerprints native inputs but excludes copied web assets', async () => {
		const { project } = await fixture();
		const initial = await fingerprintAbsoluteIosDevProject(project);
		await writeFile(
			join(project.nativeDirectory, 'App', 'App', 'public', 'page.js'),
			'web two\n'
		);
		expect(await fingerprintAbsoluteIosDevProject(project)).toBe(initial);
		await writeFile(
			join(project.nativeDirectory, 'App', 'App', 'AppDelegate.swift'),
			'import UIKit\n// native edit\n'
		);
		expect(await fingerprintAbsoluteIosDevProject(project)).not.toBe(
			initial
		);
	});

	test('builds, installs, launches, caches, and restores the dev projection', async () => {
		const {
			infoPath,
			nativeConfigPath,
			originalConfig,
			originalInfo,
			project
		} = await fixture();
		let installed = false;
		let builds = 0;
		let installs = 0;
		const commands: string[][] = [];
		const capture = (command: string[]): AbsoluteIosCommandResult => {
			commands.push(command);
			if (command.includes('runtimes'))
				return { exitCode: 0, stderr: '', stdout: runtimes };
			if (command.includes('devices'))
				return { exitCode: 0, stderr: '', stdout: inventory };
			if (command.includes('get_app_container'))
				return installed
					? {
							exitCode: 0,
							stderr: '',
							stdout: '/sim/Containers/Bundle/Application/App.app\n'
						}
					: { exitCode: 1, stderr: 'not installed', stdout: '' };

			return { exitCode: 0, stderr: '', stdout: '' };
		};
		const run = async (command: string[]) => {
			commands.push(command);
			if (command[0] === project.xcodebuild) {
				builds++;
				const derivedData =
					command[command.indexOf('-derivedDataPath') + 1];
				if (!derivedData) return 1;
				await mkdir(
					join(
						derivedData,
						'Build',
						'Products',
						'Debug-iphonesimulator',
						'App.app'
					),
					{ recursive: true }
				);
			}
			if (command.includes('install')) {
				installs++;
				installed = true;
			}

			return 0;
		};
		const states: string[] = [];
		const first = await startAbsoluteIosDevSession({
			capture,
			port: 3000,
			project,
			run,
			onStateChange: (state) => states.push(state),
			spawn: () => undefined
		});
		expect(first.nativeCacheHit).toBe(false);
		expect(first.udid).toBe('IOS-UDID-1');
		expect(builds).toBe(1);
		expect(installs).toBe(1);
		expect(states).toContain('ready');
		expect(await readFile(nativeConfigPath, 'utf8')).toContain(
			'capacitor-ios'
		);
		expect(await readFile(infoPath, 'utf8')).toContain(
			'NSAllowsArbitraryLoads'
		);
		await first.close();
		expect(await readFile(nativeConfigPath, 'utf8')).toBe(originalConfig);
		expect(await readFile(infoPath, 'utf8')).toBe(originalInfo);

		const second = await startAbsoluteIosDevSession({
			capture,
			port: 3000,
			project,
			run,
			spawn: () => undefined
		});
		expect(second.nativeCacheHit).toBe(true);
		expect(builds).toBe(1);
		expect(installs).toBe(1);
		await second.relaunch();
		await second.close();
		expect(
			commands.some(
				(command) =>
					command.includes('launch') &&
					command.includes('--terminate-running-process')
			)
		).toBe(true);
	});

	test('repairs an interrupted development projection', async () => {
		const { nativeConfigPath, originalConfig, project } = await fixture();
		const session = await startAbsoluteIosDevSession({
			port: 3001,
			project,
			capture: (command) => {
				if (command.includes('runtimes'))
					return { exitCode: 0, stderr: '', stdout: runtimes };
				if (command.includes('devices'))
					return { exitCode: 0, stderr: '', stdout: inventory };

				return { exitCode: 1, stderr: 'missing', stdout: '' };
			},
			run: async (command) => {
				if (command[0] === project.xcodebuild) {
					const derivedData =
						command[command.indexOf('-derivedDataPath') + 1];
					if (!derivedData) return 1;
					await mkdir(
						join(
							derivedData,
							'Build/Products/Debug-iphonesimulator/App.app'
						),
						{ recursive: true }
					);
				}

				return 0;
			},
			spawn: () => undefined
		});
		expect(await readFile(nativeConfigPath, 'utf8')).toContain(
			'capacitor-ios'
		);
		expect(await repairAbsoluteIosDevSession(project.projectRoot)).toBe(
			true
		);
		expect(await readFile(nativeConfigPath, 'utf8')).toBe(originalConfig);
		await session.close();
	});

	test('installs the existing development CA for HTTPS', async () => {
		const { project } = await fixture();
		const certificateAuthorityPath = join(
			project.projectRoot,
			'dev-ca.pem'
		);
		await writeFile(certificateAuthorityPath, 'development CA');
		const commands: string[][] = [];
		const session = await startAbsoluteIosDevSession({
			certificateAuthorityPath,
			https: true,
			port: 3041,
			project,
			capture: (command) => {
				if (command.includes('runtimes'))
					return { exitCode: 0, stderr: '', stdout: runtimes };
				if (command.includes('devices'))
					return { exitCode: 0, stderr: '', stdout: inventory };

				return { exitCode: 1, stderr: 'missing', stdout: '' };
			},
			run: async (command) => {
				commands.push(command);
				if (command[0] === project.xcodebuild) {
					const derivedData =
						command[command.indexOf('-derivedDataPath') + 1];
					if (!derivedData) return 1;
					await mkdir(
						join(
							derivedData,
							'Build/Products/Debug-iphonesimulator/App.app'
						),
						{ recursive: true }
					);
				}

				return 0;
			},
			spawn: () => undefined
		});
		expect(commands).toContainEqual([
			project.xcrun,
			'simctl',
			'keychain',
			'IOS-UDID-1',
			'add-root-cert',
			certificateAuthorityPath
		]);
		await session.close();
	});

	test('redacts credentials and parses native severity', () => {
		expect(
			redactAbsoluteIosLog(
				'authorization=Bearer abc.def token=secret password=hunter2'
			)
		).not.toContain('hunter2');
		expect(
			parseAbsoluteIosLogLine(
				'2026-08-22 12:00:00 Error App[42:1] [Absolute:HMR] apply failed'
			)
		).toMatchObject({
			level: 'error',
			message: 'apply failed',
			tag: 'Absolute:HMR'
		});
	});
});
