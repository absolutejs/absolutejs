import { describe, expect, test } from 'bun:test';
import {
	absoluteIosDeviceAcceptanceCommands,
	testAbsoluteIosPhysicalDevice
} from '../../../src/mobile/iosDeviceAcceptance';

describe('physical iOS acceptance', () => {
	test('uses devicectl without requesting a physical screenshot', () => {
		const commands = absoluteIosDeviceAcceptanceCommands({
			appId: 'com.absolutejs.example',
			device: 'DEVICE'
		});
		expect(commands.details).toEqual([
			'/usr/bin/xcrun',
			'devicectl',
			'device',
			'info',
			'details',
			'--device',
			'DEVICE'
		]);
		expect(commands.launch).toContain('--terminate-existing');
		expect(Object.values(commands).flat()).not.toContain('screenshot');
	});

	test('validates installation, relaunches, and waits for HMR', async () => {
		const commands: string[][] = [];
		let now = 100;
		let waited = false;
		const result = await testAbsoluteIosPhysicalDevice({
			appId: 'com.absolutejs.example',
			device: 'PRIVATE-DEVICE',
			capture: async (command) => {
				commands.push(command);

				return {
					exitCode: 0,
					stderr: '',
					stdout: command.includes('apps')
						? 'com.absolutejs.example'
						: ''
				};
			},
			now: () => {
				now += 50;

				return now;
			},
			waitForHmr: async () => {
				waited = true;
			}
		});
		expect(commands).toHaveLength(3);
		expect(waited).toBe(true);
		expect(result).toEqual({
			hmrConnected: true,
			installed: true,
			relaunchMs: 50
		});
		expect(JSON.stringify(result)).not.toContain('PRIVATE-DEVICE');
	});

	test('returns a share-safe device failure', async () => {
		await expect(
			testAbsoluteIosPhysicalDevice({
				appId: 'com.absolutejs.example',
				device: 'PRIVATE-DEVICE',
				capture: async () => ({
					exitCode: 1,
					stderr: 'PRIVATE-DEVICE signing account@example.com',
					stdout: ''
				}),
				waitForHmr: async () => undefined
			})
		).rejects.toThrow('The selected physical iOS device is unavailable.');
	});
});
