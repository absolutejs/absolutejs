import { describe, expect, test } from 'bun:test';
import {
	detectAbsoluteMobileHost,
	inspectAbsoluteMobileToolchain
} from '../../../src/mobile/emulatorDoctor';

describe('mobile emulator doctor', () => {
	test('detects macOS, Windows, Linux, and WSL hosts', () => {
		expect(detectAbsoluteMobileHost('darwin', false)).toBe('macos');
		expect(detectAbsoluteMobileHost('win32', false)).toBe('windows');
		expect(detectAbsoluteMobileHost('linux', false)).toBe('linux');
		expect(detectAbsoluteMobileHost('linux', true)).toBe('wsl');
	});

	test('discovers a configured Android SDK without invoking native tools', async () => {
		const root = '/sdk';
		const available = new Set([
			`${root}/platform-tools/adb`,
			`${root}/emulator/emulator`,
			`${root}/cmdline-tools/latest/bin/sdkmanager`,
			`${root}/cmdline-tools/latest/bin/avdmanager`,
			'/dev/kvm'
		]);
		const checks = await inspectAbsoluteMobileToolchain({
			env: { ANDROID_HOME: root },
			host: 'linux',
			exists: async (path) => available.has(path),
			which: (command) => (command === 'java' ? '/usr/bin/java' : null)
		});

		expect(
			checks
				.filter((check) => check.platform === 'android')
				.every((check) => check.status === 'pass')
		).toBe(true);
		expect(
			checks.find((check) => check.id === 'ios.simulator')?.status
		).toBe('skip');
	});

	test('recognizes a Windows-host adb bridge from WSL', async () => {
		const checks = await inspectAbsoluteMobileToolchain({
			env: {},
			host: 'wsl',
			exists: async () => false,
			which: (command) =>
				command === 'adb.exe'
					? '/mnt/c/Android/platform-tools/adb.exe'
					: null
		});

		expect(
			checks.find((check) => check.id === 'android.virtualization')
		).toMatchObject({ status: 'pass' });
	});

	test('reports actionable missing tool failures', async () => {
		const checks = await inspectAbsoluteMobileToolchain({
			env: {},
			host: 'macos',
			exists: async () => false,
			which: () => null
		});

		const adb = checks.find((check) => check.id === 'android.adb');
		expect(adb).toMatchObject({ status: 'fail' });
		expect(adb?.remediation).toContain('Platform Tools');
		expect(checks.find((check) => check.id === 'ios.xcrun')).toMatchObject({
			status: 'fail'
		});
	});
});
