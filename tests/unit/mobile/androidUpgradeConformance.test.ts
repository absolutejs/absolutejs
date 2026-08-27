import { describe, expect, test } from 'bun:test';
import {
	parseAbsoluteAndroidInstalledApp,
	runAbsoluteAndroidUpgradeConformance,
	type AbsoluteAndroidUpgradeCommandResult
} from '../../../src/mobile/androidUpgradeConformance';

const dumpsys = (versionCode: number, lastUpdateTime: string) => `
  Package [com.absolutejs.app] (abc123):
    userId=10123
    versionCode=${versionCode} minSdk=24 targetSdk=36
    versionName=0.20.0-beta.${versionCode}
    dataDir=/data/user/0/com.absolutejs.app
    firstInstallTime=2026-08-27 10:00:00
    lastUpdateTime=${lastUpdateTime}
`;

describe('Android installed-app upgrade conformance', () => {
	test('parses the stable package identity and build version', () => {
		expect(
			parseAbsoluteAndroidInstalledApp(
				'com.absolutejs.app',
				dumpsys(41, '2026-08-27 10:05:00')
			)
		).toEqual({
			appId: 'com.absolutejs.app',
			dataDirectory: '/data/user/0/com.absolutejs.app',
			firstInstallTime: '2026-08-27 10:00:00',
			lastUpdateTime: '2026-08-27 10:05:00',
			uid: '10123',
			versionCode: 41,
			versionName: '0.20.0-beta.41'
		});
	});

	test('proves replace install, app-private state, retention, and rollback', async () => {
		let inspections = 0;
		const commands: string[][] = [];
		const run = async (
			command: string[]
		): Promise<AbsoluteAndroidUpgradeCommandResult> => {
			commands.push(command);
			if (command.includes('dumpsys')) {
				inspections += 1;

				return {
					exitCode: 0,
					stderr: '',
					stdout: dumpsys(
						inspections === 1 ? 41 : 42,
						inspections === 1
							? '2026-08-27 10:05:00'
							: '2026-08-27 10:10:00'
					)
				};
			}

			return { exitCode: 0, stderr: '', stdout: 'Success\n' };
		};
		const result = await runAbsoluteAndroidUpgradeConformance({
			adb: '/sdk/adb',
			apkPath: '/build/app-42.apk',
			appId: 'com.absolutejs.app',
			compatibility: {
				nPlusOne: 'compatible',
				nPlusThree: 'upgrade-required',
				nPlusTwo: 'compatible',
				rollback: 'compatible'
			},
			run,
			serial: 'emulator-5554',
			verifyState: async () => ({
				authCredential: true,
				pendingOperations: true,
				syncDatabase: true
			})
		});
		expect(result).toMatchObject({
			after: { versionCode: 42 },
			before: { versionCode: 41 },
			outcome: 'pass'
		});
		expect(commands[1]).toEqual([
			'/sdk/adb',
			'-s',
			'emulator-5554',
			'install',
			'-r',
			'/build/app-42.apk'
		]);
	});

	test('rejects an install that resets the application identity', async () => {
		let inspections = 0;
		await expect(
			runAbsoluteAndroidUpgradeConformance({
				adb: 'adb',
				apkPath: 'next.apk',
				appId: 'com.absolutejs.app',
				serial: 'emulator-5554',
				run: async (command) => {
					if (command.includes('dumpsys')) {
						inspections += 1;

						return {
							exitCode: 0,
							stderr: '',
							stdout: dumpsys(40 + inspections, 'now').replace(
								'userId=10123',
								`userId=${inspections === 1 ? '10123' : '10999'}`
							)
						};
					}

					return { exitCode: 0, stderr: '', stdout: 'Success' };
				},
				verifyState: async () => ({
					authCredential: true,
					pendingOperations: true,
					syncDatabase: true
				})
			})
		).rejects.toThrow('application UID changed');
	});
});
