import { describe, expect, test } from 'bun:test';
import { waitForAbsoluteAndroidNetworkServices } from '../../../src/mobile/androidServiceReadiness';

describe('Android offline service readiness', () => {
	test('waits for delayed telephony without mutating network settings', async () => {
		const commands: string[][] = [];
		let phoneChecks = 0;
		await waitForAbsoluteAndroidNetworkServices({
			adb: 'adb',
			pollMs: 1,
			serial: 'emulator-5554',
			timeoutMs: 1000,
			run: async (command) => {
				commands.push(command);
				const service = command.at(-1);
				const ready = service !== 'phone' || ++phoneChecks > 1;

				return {
					exitCode: 0,
					stdout: `Service ${service}: ${ready ? 'found' : 'not found'}\r\n`
				};
			}
		});
		expect(phoneChecks).toBe(2);
		expect(
			commands.every(
				(command) =>
					command.slice(3, 6).join(' ') === 'shell service check'
			)
		).toBe(true);
	});
	test('fails closed when services never register, even with a zero exit status', async () => {
		await expect(
			waitForAbsoluteAndroidNetworkServices({
				adb: 'adb',
				serial: 'emulator-5554',
				timeoutMs: 0,
				run: async () => ({
					exitCode: 0,
					stdout: 'Service phone: not found\n'
				})
			})
		).rejects.toThrow('no network settings were changed');
	});
	test('does not accept a failed command containing ready text', async () => {
		await expect(
			waitForAbsoluteAndroidNetworkServices({
				adb: 'adb',
				serial: 'emulator-5554',
				timeoutMs: 0,
				run: async (command) => ({
					exitCode: 1,
					stdout: `Service ${command.at(-1)}: found`
				})
			})
		).rejects.toThrow('wifi, phone');
	});
});
