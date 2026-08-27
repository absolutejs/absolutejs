import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	createAbsoluteIosPartnerReport,
	renderAbsoluteIosPartnerReport,
	sanitizeIosReportText,
	writeAbsoluteIosPartnerReport,
	type AbsoluteIosAutomatedResult
} from '../../../src/mobile/iosTestReport';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});

const passingRun: AbsoluteIosAutomatedResult = {
	appId: 'com.absolutejs.example',
	durationMs: 412,
	hmrConnected: true,
	port: 3000,
	screenshot: '/project/report/ios-simulator.png',
	status: 'pass',
	udid: 'SAFE-SIMULATOR-ID'
};

describe('iOS partner test report', () => {
	test('redacts credentials, URL query values, and exact coordinates', () => {
		const value = sanitizeIosReportText(
			'Bearer abc access_token=secret latitude: 40.7128 longitude=-74.006 https://example.com/callback?code=secret'
		);
		expect(value).not.toContain('abc');
		expect(value).not.toContain('secret');
		expect(value).not.toContain('40.7128');
		expect(value).not.toContain('-74.006');
		expect(value).toContain('[REDACTED]');
	});

	test('keeps manual checks incomplete instead of fabricating passes', () => {
		const report = createAbsoluteIosPartnerReport({
			absolutejsVersion: '0.20.0-beta.24',
			bunVersion: '1.3.0',
			generatedAt: '2026-08-26T12:00:00.000Z',
			macosVersion: '15.6',
			run: passingRun,
			xcodeVersion: 'Xcode 16.4'
		});
		expect(report.overallResult).toBe('INCOMPLETE');
		expect(report.manualChecks).toHaveLength(62);
		expect(
			report.manualChecks.find(({ id }) => id === 'FILES-08')
		).toMatchObject({
			result: 'NOT_RUN'
		});
		expect(
			report.manualChecks.find(({ id }) => id === 'NOTIF-08')
		).toMatchObject({ result: 'NOT_RUN' });
		expect(
			report.manualChecks.find(({ id }) => id === 'SYSUI-08')
		).toMatchObject({ result: 'NOT_RUN' });
		expect(
			report.manualChecks.find(({ id }) => id === 'PUSH-08')
		).toMatchObject({ result: 'NOT_RUN' });
		expect(
			report.manualChecks.every(({ result }) => result === 'NOT_RUN')
		).toBe(true);
		expect(
			report.automatedChecks.find(({ id }) => id === 'AUTO-DEV-01')
		).toMatchObject({ result: 'PASS' });
		expect(
			report.automatedChecks.find(({ id }) => id === 'AUTO-HMR-01')
		).toMatchObject({ result: 'NOT_RUN' });
	});

	test('writes matching Markdown and machine-readable reports', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'absolute-ios-report-'));
		temporaryDirectories.push(directory);
		const report = createAbsoluteIosPartnerReport({
			absolutejsVersion: '0.20.0-beta.24',
			bunVersion: '1.3.0',
			macosVersion: '15.6',
			run: {
				...passingRun,
				hmr: {
					clientMs: 21,
					durationMs: 40,
					outcome: 'applied',
					serverMs: 19
				}
			},
			xcodeVersion: 'Xcode 16.4'
		});
		const paths = await writeAbsoluteIosPartnerReport(directory, report);
		const [markdown, json] = await Promise.all([
			readFile(paths.markdownPath, 'utf8'),
			readFile(paths.jsonPath, 'utf8')
		]);
		expect(markdown).toContain('| AUTO-HMR-01 | PASS |');
		expect(markdown).toContain('| LOC-14 | NOT_RUN |');
		expect(markdown).toContain('| NOTIF-08 | NOT_RUN |');
		expect(markdown).toContain('| SYSUI-08 | NOT_RUN |');
		expect(markdown).toContain('| PUSH-08 | NOT_RUN |');
		expect(markdown).toContain(
			'This report is local and is never uploaded'
		);
		expect(JSON.parse(json)).toEqual(report);
		expect(renderAbsoluteIosPartnerReport(report)).toBe(markdown);
	});
});
