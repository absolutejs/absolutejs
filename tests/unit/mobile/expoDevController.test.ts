import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess, spawn } from 'node:child_process';
import { normalizeAbsoluteMobileConfig } from '../../../src/mobile/config';
import {
	installAbsoluteExpoAndroidRelease,
	installAbsoluteExpoIosRelease,
	parseBootedAbsoluteExpoIosSimulators,
	planAbsoluteExpoDevSession,
	startAbsoluteExpoDevSession
} from '../../../src/mobile/expoDevController';

const config = normalizeAbsoluteMobileConfig(
	{
		appId: 'com.example.product',
		appName: 'Product',
		engine: 'expo',
		platforms: ['android', 'ios'],
		server: { productionOrigin: 'https://api.example.com' }
	},
	'/workspace'
);

const processHarness = () => {
	const commands: string[][] = [];
	const running = new Set<ChildProcess>();
	const spawnProcess = ((command: string, args: readonly string[]) => {
		commands.push([command, ...args]);
		const child = new EventEmitter() as ChildProcess;
		const stdout = new PassThrough();
		const stderr = new PassThrough();
		Object.assign(child, {
			exitCode: null,
			killed: false,
			stderr,
			stdout,
			kill: () => {
				if (child.exitCode !== null) return true;
				Reflect.set(child, 'killed', true);
				Reflect.set(child, 'exitCode', 0);
				queueMicrotask(() => child.emit('exit', 0));

				return true;
			}
		});
		running.add(child);
		if (args[0] === 'start') {
			queueMicrotask(() =>
				stdout.write('Metro waiting on exp://localhost\n')
			);
		} else {
			queueMicrotask(() => {
				Reflect.set(child, 'exitCode', 0);
				child.emit('exit', 0);
				stdout.end();
				stderr.end();
			});
		}

		return child;
	}) as typeof spawn;

	return { commands, running, spawnProcess };
};

describe('Expo development controller', () => {
	test('coordinates one Metro server and both native development builds', () => {
		const plan = planAbsoluteExpoDevSession(config, {
			androidDevice: 'emulator-5554',
			androidOrigin: 'http://10.0.2.2:3000',
			certificateAuthorityPath: '/workspace/dev-ca.pem',
			iosOrigin: 'http://localhost:3000',
			metroPort: 8123,
			platforms: ['android', 'ios']
		});

		expect(plan.project).toBe('/workspace/.absolutejs/mobile/expo');
		expect(plan.commands).toHaveLength(4);
		expect(plan.commands[0]).toMatchObject({
			args: ['prebuild', '--clean', '--no-install', '--platform', 'all'],
			role: 'native-prepare'
		});
		expect(plan.commands[1]).toMatchObject({
			args: [
				'start',
				'--dev-client',
				'--host',
				'localhost',
				'--port',
				'8123'
			],
			role: 'metro'
		});
		expect(plan.commands[2]?.args).toEqual([
			'run:android',
			'--no-bundler',
			'--device',
			'emulator-5554'
		]);
		expect(plan.commands[3]?.args).toEqual(['run:ios', '--no-bundler']);
		expect(plan.commands[1]?.env).toMatchObject({
			ABSOLUTE_EXPO_DEVELOPMENT: '1',
			ABSOLUTE_EXPO_DEVELOPMENT_CA_PATH: '/workspace/dev-ca.pem',
			EXPO_PUBLIC_ABSOLUTE_DEV_ANDROID_ORIGIN: 'http://10.0.2.2:3000',
			EXPO_PUBLIC_ABSOLUTE_DEV_IOS_ORIGIN: 'http://localhost:3000',
			NODE_ENV: 'development'
		});
	});

	test('requires a development CA for HTTPS origins', () => {
		expect(() =>
			planAbsoluteExpoDevSession(config, {
				androidOrigin: 'https://10.0.2.2:3000',
				metroPort: 8081,
				platforms: ['android']
			})
		).toThrow('development CA certificate');
	});

	test('can own Metro while native iOS executes on a Remote Mac', () => {
		const plan = planAbsoluteExpoDevSession(config, {
			metroPort: 8081,
			platforms: []
		});
		expect(plan.commands).toHaveLength(1);
		expect(plan.commands[0]?.role).toBe('metro');
		expect(() =>
			planAbsoluteExpoDevSession(config, {
				metro: 'external',
				metroPort: 8081,
				platforms: []
			})
		).toThrow('requires a target platform');
	});

	test('uses an externally tunneled Metro without starting a second server', () => {
		const plan = planAbsoluteExpoDevSession(config, {
			iosOrigin: 'http://localhost:3000',
			metro: 'external',
			metroHost: 'macbook.local',
			metroPort: 8123,
			platforms: ['ios']
		});
		expect(plan.commands.map((command) => command.role)).toEqual([
			'native-prepare',
			'native-build'
		]);
		expect(plan.commands[0]?.env.REACT_NATIVE_PACKAGER_HOSTNAME).toBe(
			'macbook.local'
		);
	});

	test('builds and closes against an externally managed Metro session', async () => {
		const harness = processHarness();
		const session = await startAbsoluteExpoDevSession({
			config,
			executable: '/workspace/expo',
			iosOrigin: 'http://localhost:3000',
			metro: 'external',
			metroPort: 8123,
			platforms: ['ios'],
			spawnProcess: harness.spawnProcess
		});
		expect(harness.commands.some((command) => command[1] === 'start')).toBe(
			false
		);
		expect(harness.commands).toContainEqual([
			'/workspace/expo',
			'run:ios',
			'--no-bundler'
		]);
		await session.close();
	});

	test('mirrors Expo Android builds onto the Windows host from WSL', async () => {
		const harness = processHarness();
		const logs: string[] = [];
		const session = await startAbsoluteExpoDevSession({
			androidOrigin: 'http://localhost:3000',
			androidRoot: '/mnt/c/AbsoluteJS/Android/Sdk',
			config,
			executable: '/workspace/expo',
			host: 'wsl',
			metro: 'external',
			metroPort: 8123,
			platforms: ['android'],
			spawnProcess: harness.spawnProcess,
			capture: ([command, flag, path]) => {
				let stdout = 'C:\\AbsoluteJS\\Android\\Sdk\n';
				if (path === '/workspace/.absolutejs/mobile/expo')
					stdout =
						'\\\\wsl.localhost\\Ubuntu\\workspace\\.absolutejs\\mobile\\expo\n';
				else if (path?.startsWith('/mnt/c/AbsoluteJS/ExpoBuilds/'))
					stdout = 'C:\\AbsoluteJS\\ExpoBuilds\\product\n';

				return {
					exitCode: command === 'wslpath' && flag === '-w' ? 0 : 1,
					stdout
				};
			},
			log: (line) => logs.push(line)
		});
		const invocation = harness.commands.find(
			([command]) => command === 'powershell.exe'
		);
		expect(invocation).toBeDefined();
		const encoded = invocation?.at(-1);
		expect(encoded).toBeString();
		const script = Buffer.from(encoded ?? '', 'base64').toString('utf16le');
		expect(script).toContain('robocopy.exe $source $directory /MIR');
		expect(script).toContain(
			'/XD node_modules .expo .git .gradle .cxx .kotlin build'
		);
		expect(script).toContain(
			'/XF bun.lock bun.lockb .absolutejs-preserve-subst.cjs'
		);
		expect(script).toContain('Get-Command bun.exe -ErrorAction Stop');
		expect(script).toContain('$staleDrives = @(& subst.exe)');
		expect(script).toContain(
			'foreach ($staleDrive in $staleDrives) { & subst.exe $staleDrive /D'
		);
		expect(script).toContain('& subst.exe $drive $mirrorRoot');
		expect(script).toContain('& subst.exe $drive /D');
		expect(script).toContain('$mappedProject = Join-Path');
		expect(script).toContain('Set-Location $mappedProject');
		expect(script).toContain('.absolutejs-preserve-subst.cjs');
		expect(script).toContain(
			'$env:ABSOLUTE_EXPO_PHYSICAL_ROOT = $directory'
		);
		expect(script).toContain(
			'$env:ABSOLUTE_EXPO_MAPPED_ROOT = $mappedProject'
		);
		expect(script).toContain(
			'$env:ABSOLUTE_EXPO_APP_ROOT = $mappedProject'
		);
		expect(script).toContain('$env:NODE_OPTIONS = "--require=$hook"');
		expect(script).toContain('-Dorg.gradle.daemon=false');
		expect(script).toContain('android\\build\\generated\\autolinking');
		expect(script).toContain(
			"$env:ORG_GRADLE_PROJECT_reactNativeArchitectures = 'x86_64'"
		);
		expect(script).toContain("shell am force-stop 'com.example.product'");
		expect(script).toContain('Start-Sleep -Milliseconds 1000');
		const argumentsMatch =
			/FromBase64String\('([^']+)'\)\) \| ConvertFrom-Json/u.exec(script);
		expect(argumentsMatch?.[1]).toBeString();
		const expoArguments = JSON.parse(
			Buffer.from(argumentsMatch?.[1] ?? '', 'base64').toString('utf8')
		);
		expect(expoArguments).toEqual(['run:android', '--no-bundler']);
		expect(script).toContain("reverse 'tcp:8123' 'tcp:8123'");
		expect(script).toContain(
			'exp+com-example-product://expo-development-client/'
		);
		expect(script).toContain('android.intent.action.VIEW');
		expect(logs.join('\n')).toContain('Windows host');
		await session.close();
	});

	test('builds and launches an installable Expo Android release from WSL', async () => {
		const harness = processHarness();
		const release = await installAbsoluteExpoAndroidRelease({
			androidRoot: '/mnt/c/AbsoluteJS/Android/Sdk',
			config,
			executable: '/workspace/expo',
			forwardedPort: 3456,
			host: 'wsl',
			spawnProcess: harness.spawnProcess,
			capture: ([command, flag, path]) => {
				if (command?.endsWith('adb.exe') && flag === 'devices')
					return { exitCode: 0, stdout: 'emulator-5554\tdevice\n' };
				let stdout = 'C:\\AbsoluteJS\\Android\\Sdk\n';
				if (path === '/workspace/.absolutejs/mobile/expo')
					stdout =
						'\\\\wsl.localhost\\Ubuntu\\workspace\\.absolutejs\\mobile\\expo\n';
				else if (path?.startsWith('/mnt/c/AbsoluteJS/ExpoBuilds/'))
					stdout = 'C:\\AbsoluteJS\\ExpoBuilds\\product\n';

				return {
					exitCode: command === 'wslpath' && flag === '-w' ? 0 : 1,
					stdout
				};
			}
		});

		expect(release.serial).toBe('emulator-5554');
		expect(harness.commands[0]).toEqual([
			'/workspace/expo',
			'prebuild',
			'--clean',
			'--no-install',
			'--platform',
			'android'
		]);
		const invocation = harness.commands.find(
			([command]) => command === 'powershell.exe'
		);
		const script = Buffer.from(invocation?.at(-1) ?? '', 'base64').toString(
			'utf16le'
		);
		expect(script).toContain("$env:NODE_ENV = 'production'");
		expect(script).toContain(
			'& $gradle --no-daemon --console=plain -p $androidProject assembleRelease'
		);
		expect(script).toContain('[DateTime]::UtcNow.AddSeconds(60)');
		expect(script).toContain(
			"Start-Process -FilePath $adb -ArgumentList @('-s', $serial, 'install', '-r', $apk)"
		);
		expect(script).toContain('$install.WaitForExit(900000)');
		expect(script).toContain('$install.WaitForExit()');
		expect(script).toContain("$installText -notmatch '(?m)^Success\\r?$'");
		expect(script).toContain('shell pm path');
		expect(script).toContain("reverse 'tcp:3456' 'tcp:3456'");
		expect(script).toContain(
			"shell monkey -p 'com.example.product' -c android.intent.category.LAUNCHER 1"
		);
		expect(script).not.toContain('expo-development-client/?url=');
	});

	test('builds and launches an installable Expo iOS Simulator release', async () => {
		const harness = processHarness();
		const captures: string[][] = [];
		const inventory = JSON.stringify({
			devices: {
				'com.apple.CoreSimulator.SimRuntime.iOS-26-0': [
					{
						isAvailable: true,
						state: 'Booted',
						udid: 'IOS-UDID-1'
					}
				]
			}
		});
		const release = await installAbsoluteExpoIosRelease({
			config,
			executable: '/workspace/expo',
			spawnProcess: harness.spawnProcess,
			xcrun: '/usr/bin/xcrun',
			capture: (command) => {
				captures.push(command);

				return command.includes('list')
					? { exitCode: 0, stdout: inventory }
					: { exitCode: 0, stdout: '' };
			}
		});

		expect(release.udid).toBe('IOS-UDID-1');
		expect(harness.commands).toEqual([
			[
				'/workspace/expo',
				'prebuild',
				'--clean',
				'--no-install',
				'--platform',
				'ios'
			],
			[
				'/workspace/expo',
				'run:ios',
				'--configuration',
				'Release',
				'--no-bundler',
				'--device',
				'IOS-UDID-1'
			]
		]);
		expect(captures).toContainEqual([
			'/usr/bin/xcrun',
			'simctl',
			'launch',
			'--terminate-running-process',
			'IOS-UDID-1',
			'com.example.product'
		]);
	});

	test('discovers the iOS Simulator that Expo boots for a first release', async () => {
		const harness = processHarness();
		let inventoryReads = 0;
		const release = await installAbsoluteExpoIosRelease({
			config,
			executable: '/workspace/expo',
			spawnProcess: harness.spawnProcess,
			xcrun: '/usr/bin/xcrun',
			capture: (command) => {
				if (!command.includes('list'))
					return { exitCode: 0, stdout: '' };
				inventoryReads += 1;

				return {
					exitCode: 0,
					stdout: JSON.stringify({
						devices:
							inventoryReads === 1
								? {}
								: {
										runtime: [
											{
												state: 'Booted',
												udid: 'IOS-BOOTED-BY-EXPO'
											}
										]
									}
					})
				};
			}
		});

		expect(release.udid).toBe('IOS-BOOTED-BY-EXPO');
		expect(inventoryReads).toBe(2);
		expect(harness.commands[1]).toEqual([
			'/workspace/expo',
			'run:ios',
			'--configuration',
			'Release',
			'--no-bundler'
		]);
	});

	test('parses only available booted Expo iOS Simulators', () => {
		expect(
			parseBootedAbsoluteExpoIosSimulators(
				JSON.stringify({
					devices: {
						runtime: [
							{ state: 'Booted', udid: 'IOS-1' },
							{
								isAvailable: false,
								state: 'Booted',
								udid: 'IOS-2'
							},
							{ state: 'Shutdown', udid: 'IOS-3' }
						]
					}
				})
			)
		).toEqual(['IOS-1']);
		expect(() => parseBootedAbsoluteExpoIosSimulators('not-json')).toThrow(
			'Invalid iOS Simulator inventory JSON'
		);
	});

	test('restarts a local Android development client on the managed Metro URL', async () => {
		const harness = processHarness();
		const captures: string[][] = [];
		const session = await startAbsoluteExpoDevSession({
			androidAdb: '/sdk/adb',
			config,
			executable: '/workspace/expo',
			host: 'linux',
			metro: 'external',
			metroPort: 8123,
			platforms: ['android'],
			spawnProcess: harness.spawnProcess,
			capture: (command) => {
				captures.push(command);
				const stdout =
					command.at(-1) === 'devices'
						? 'emulator-5554\tdevice\n'
						: '';

				return {
					exitCode: 0,
					stdout
				};
			}
		});
		expect(captures).toContainEqual(['/sdk/adb', 'devices']);
		expect(captures).toContainEqual([
			'/sdk/adb',
			'-s',
			'emulator-5554',
			'reverse',
			'tcp:8123',
			'tcp:8123'
		]);
		expect(captures).toContainEqual([
			'/sdk/adb',
			'-s',
			'emulator-5554',
			'shell',
			'am',
			'force-stop',
			'com.example.product'
		]);
		expect(
			captures.some(
				(command) =>
					command.includes('android.intent.action.VIEW') &&
					command.some((value) => value.includes('localhost%3A8123'))
			)
		).toBe(true);
		await session.close();
	});

	test('trusts and relaunches the booted iOS Simulator for HTTPS', async () => {
		const harness = processHarness();
		const logs: string[] = [];
		const session = await startAbsoluteExpoDevSession({
			certificateAuthorityPath: '/workspace/dev-ca.pem',
			config,
			executable: '/workspace/expo',
			iosOrigin: 'https://localhost:3000',
			metroPort: 8123,
			platforms: ['ios'],
			spawnProcess: harness.spawnProcess,
			log: (line) => logs.push(line)
		});

		expect(harness.commands).toContainEqual([
			'xcrun',
			'simctl',
			'keychain',
			'booted',
			'add-root-cert',
			'/workspace/dev-ca.pem'
		]);
		expect(harness.commands).toContainEqual([
			'xcrun',
			'simctl',
			'launch',
			'booted',
			'com.example.product'
		]);
		expect(harness.commands).toContainEqual([
			'xcrun',
			'simctl',
			'openurl',
			'booted',
			'exp+com-example-product://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8123'
		]);
		expect(logs.join('\n')).toContain('relaunched the app');
		await session.close();
	});

	test('serves physical iOS enrollment only for the session', async () => {
		const harness = processHarness();
		let closed = false;
		const logs: string[] = [];
		const session = await startAbsoluteExpoDevSession({
			certificateAuthorityPath: '/workspace/dev-ca.pem',
			config,
			executable: '/workspace/expo',
			iosDevice: 'Alex iPhone',
			iosOrigin: 'https://macbook.local:3000',
			metroPort: 8123,
			platforms: ['ios'],
			spawnProcess: harness.spawnProcess,
			log: (line) => logs.push(line),
			startCaEnrollmentServer: async (options) => {
				expect(options).toEqual({
					certificateAuthorityPath: '/workspace/dev-ca.pem',
					displayHost: 'macbook.local'
				});

				return {
					url: 'http://macbook.local:9000/token/ca.cer',
					close: async () => {
						closed = true;
					}
				};
			}
		});

		expect(logs.join('\n')).toContain(
			'http://macbook.local:9000/token/ca.cer'
		);
		expect(closed).toBe(false);
		await session.close();
		expect(closed).toBe(true);
	});
});
