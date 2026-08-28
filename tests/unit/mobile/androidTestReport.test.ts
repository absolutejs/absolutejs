import { describe, expect, test } from 'bun:test';
import { createAbsoluteAndroidTestReport } from '../../../src/mobile/androidTestReport';
import {
	renderAbsoluteNativeTestReport,
	sanitizeNativeReportText
} from '../../../src/mobile/nativeTestReport';

describe('Android native test report', () => {
	test('redacts native credential-shaped values from local evidence', () => {
		expect(
			sanitizeNativeReportText(
				'{"value":"refresh-123e4567-e89b-12d3-a456-426614174000"}'
			)
		).toBe('{"value":"[REDACTED]"}');
	});

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
		expect(
			report.manualChecks.find(({ id }) => id === 'MIGRATE-02')
		).toBeDefined();
		expect(renderAbsoluteNativeTestReport(report)).toContain(
			'Routes: /react, /vue.'
		);
	});

	test('records generated schema failure, rollback, and recovery evidence', () => {
		const report = createAbsoluteAndroidTestReport({
			absolutejsVersion: '0.20.0-beta.30',
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
				syncMigration: {
					durationMs: 80,
					failedAttempt: {
						code: 'INVALID_PLAN',
						storedVersion: 1,
						targetVersion: 2
					},
					outcome: 'pass',
					recovery: { storedVersion: 2, targetVersion: 2 },
					state: {
						authCredential: true,
						pendingOperations: true,
						rollbackPreserved: true,
						schemaAdvanced: true
					}
				}
			}
		});
		expect(
			report.automatedChecks.find(({ id }) => id === 'AUTO-MIGRATE-01')
		).toMatchObject({ result: 'PASS' });
		expect(
			report.automatedChecks.find(({ id }) => id === 'AUTO-MIGRATE-02')
		).toMatchObject({ result: 'PASS' });
		expect(JSON.stringify(report)).not.toContain('row and field');
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
