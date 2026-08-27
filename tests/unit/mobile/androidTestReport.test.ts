import { describe, expect, test } from 'bun:test';
import { createAbsoluteAndroidTestReport } from '../../../src/mobile/androidTestReport';
import { renderAbsoluteNativeTestReport } from '../../../src/mobile/nativeTestReport';

describe('Android native test report', () => {
	test('uses the shared report contract without fabricating manual results', () => {
		const report = createAbsoluteAndroidTestReport({
			absolutejsVersion: '0.20.0-beta.24',
			adbVersion: 'Android Debug Bridge version 1.0.41',
			bunVersion: '1.3.14',
			generatedAt: '2026-08-26T12:00:00.000Z',
			host: 'linux-x64',
			run: {
				appId: 'com.absolutejs.example',
				durationMs: 350,
				hmrConnected: true,
				port: 3000,
				routes: ['/react', '/vue'],
				screenshot: '/project/report/android-emulator.png',
				serial: 'emulator-5554',
				status: 'pass'
			}
		});
		expect(report).toMatchObject({
			overallResult: 'INCOMPLETE',
			platform: 'android',
			run: { targetId: 'emulator-5554', targetKind: 'emulator' }
		});
		expect(
			report.manualChecks.every(({ result }) => result === 'NOT_RUN')
		).toBe(true);
		expect(
			report.manualChecks.find(({ id }) => id === 'NOTIF-06')
		).toMatchObject({
			result: 'NOT_RUN'
		});
		expect(
			report.manualChecks.find(({ id }) => id === 'SYSUI-08')
		).toMatchObject({
			result: 'NOT_RUN'
		});
		expect(
			report.manualChecks.filter(({ id }) => id.startsWith('SYSUI-'))
		).toHaveLength(8);
		expect(
			report.manualChecks.find(({ id }) => id === 'UPGRADE-01')
		).toBeDefined();
		expect(renderAbsoluteNativeTestReport(report)).toContain(
			'Routes: /react, /vue.'
		);
	});

	test('records sanitized installed-upgrade and compatibility evidence', () => {
		const report = createAbsoluteAndroidTestReport({
			absolutejsVersion: '0.20.0-beta.29',
			adbVersion: 'adb',
			bunVersion: '1.3.14',
			host: 'linux-x64',
			run: {
				appId: 'com.absolutejs.example',
				durationMs: 100,
				hmrConnected: true,
				port: 3000,
				serial: 'emulator-5554',
				status: 'pass',
				upgrade: {
					after: { appId: 'com.absolutejs.example', versionCode: 12 },
					before: {
						appId: 'com.absolutejs.example',
						versionCode: 11
					},
					compatibility: {
						nPlusOne: 'compatible',
						nPlusThree: 'upgrade-required',
						nPlusTwo: 'compatible',
						rollback: 'compatible'
					},
					durationMs: 90,
					installMs: 70,
					outcome: 'pass',
					state: {
						authCredential: true,
						pendingOperations: true,
						syncDatabase: true
					}
				}
			}
		});
		expect(
			report.automatedChecks.find(({ id }) => id === 'AUTO-UPGRADE-01')
		).toMatchObject({ result: 'PASS' });
		expect(
			report.automatedChecks.find(({ id }) => id === 'AUTO-COMPAT-01')
		).toMatchObject({ result: 'PASS' });
	});

	test('classifies a physical target and preserves a sanitized failure', () => {
		const report = createAbsoluteAndroidTestReport({
			absolutejsVersion: '0.20.0-beta.24',
			adbVersion: 'adb',
			bunVersion: '1.3.14',
			host: 'darwin-arm64',
			run: {
				appId: 'com.absolutejs.example',
				durationMs: 40,
				error: 'permission denied',
				hmrConnected: false,
				port: 3000,
				serial: 'PHONE-ID',
				status: 'fail'
			}
		});
		expect(report.overallResult).toBe('FAIL');
		expect(report.run.targetKind).toBe('device');
	});
});
