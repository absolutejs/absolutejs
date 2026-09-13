import { describe, expect, test } from 'bun:test';
import {
	assertAbsoluteIosInstalledAppUpgrade,
	inspectAbsoluteIosInstalledApp,
	parseAbsoluteIosInstalledAppInfo,
	type AbsoluteIosInstalledApp
} from '../../../src/mobile/iosUpgradeConformance';

const before: AbsoluteIosInstalledApp = {
	appContainer: '/app/one/Acceptance.app',
	appId: 'com.absolutejs.acceptance',
	buildNumber: '41',
	dataContainer: '/data/stable',
	version: '1.2.3'
};

describe('Expo iOS installed-app upgrade conformance', () => {
	test('parses installed bundle metadata without exposing plist contents', () => {
		expect(
			parseAbsoluteIosInstalledAppInfo(
				before.appId,
				before.appContainer,
				before.dataContainer,
				JSON.stringify({
					CFBundleIdentifier: before.appId,
					CFBundleShortVersionString: '1.2.3',
					CFBundleVersion: 41,
					SecretFixture: 'must-not-escape'
				})
			)
		).toEqual(before);
	});

	test('rejects malformed metadata and the wrong bundle', () => {
		expect(() =>
			parseAbsoluteIosInstalledAppInfo('app', '/app', '/data', 'not-json')
		).toThrow('Invalid installed iOS application Info.plist JSON');
		expect(() =>
			parseAbsoluteIosInstalledAppInfo(
				'app',
				'/app',
				'/data',
				'{"CFBundleIdentifier":"other"}'
			)
		).toThrow('identifier mismatch');
	});

	test('inspects app/data containers and installed Info.plist', async () => {
		const commands: string[][] = [];
		const installed = await inspectAbsoluteIosInstalledApp(
			'xcrun',
			'SIMULATOR',
			before.appId,
			async (command) => {
				commands.push(command);
				if (command.includes('data'))
					return {
						exitCode: 0,
						stderr: '',
						stdout: before.dataContainer
					};
				if (command.includes('app'))
					return {
						exitCode: 0,
						stderr: '',
						stdout: before.appContainer
					};

				return {
					exitCode: 0,
					stderr: '',
					stdout: JSON.stringify({
						CFBundleIdentifier: before.appId,
						CFBundleShortVersionString: before.version,
						CFBundleVersion: before.buildNumber
					})
				};
			}
		);
		expect(installed).toEqual(before);
		expect(commands).toEqual([
			[
				'xcrun',
				'simctl',
				'get_app_container',
				'SIMULATOR',
				before.appId,
				'data'
			],
			[
				'xcrun',
				'simctl',
				'get_app_container',
				'SIMULATOR',
				before.appId,
				'app'
			],
			[
				'/usr/bin/plutil',
				'-convert',
				'json',
				'-o',
				'-',
				`${before.appContainer}/Info.plist`
			]
		]);
	});

	test('accepts a replacement with stable data and increasing build number', () => {
		expect(() =>
			assertAbsoluteIosInstalledAppUpgrade(before, {
				...before,
				appContainer: '/app/two/Acceptance.app',
				buildNumber: '42'
			})
		).not.toThrow();
	});

	test('rejects identity, data, and build-number regressions', () => {
		expect(() =>
			assertAbsoluteIosInstalledAppUpgrade(before, {
				...before,
				appId: 'com.absolutejs.other',
				buildNumber: '42'
			})
		).toThrow('bundle identifier changed');
		expect(() =>
			assertAbsoluteIosInstalledAppUpgrade(before, {
				...before,
				buildNumber: '42',
				dataContainer: '/data/replaced'
			})
		).toThrow('data container changed');
		expect(() =>
			assertAbsoluteIosInstalledAppUpgrade(before, {
				...before,
				buildNumber: '41'
			})
		).toThrow('did not increase');
		expect(() =>
			assertAbsoluteIosInstalledAppUpgrade(before, {
				...before,
				buildNumber: 'release-two'
			})
		).toThrow('numeric CFBundleVersion');
	});
});
