import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess, spawn } from 'node:child_process';
import { normalizeAbsoluteMobileConfig } from '../../../src/mobile/config';
import {
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
			'--port',
			'8123',
			'--device',
			'emulator-5554'
		]);
		expect(plan.commands[3]?.args).toEqual([
			'run:ios',
			'--no-bundler',
			'--port',
			'8123'
		]);
		expect(plan.commands[1]?.env).toMatchObject({
			ABSOLUTE_EXPO_DEVELOPMENT: '1',
			ABSOLUTE_EXPO_DEVELOPMENT_CA_PATH: '/workspace/dev-ca.pem',
			EXPO_PUBLIC_ABSOLUTE_DEV_ANDROID_ORIGIN: 'http://10.0.2.2:3000',
			EXPO_PUBLIC_ABSOLUTE_DEV_IOS_ORIGIN: 'http://localhost:3000'
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
			'--no-bundler',
			'--port',
			'8123'
		]);
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
