import { describe, expect, test } from 'bun:test';
import {
	fixAbsoluteMobileEmulatorToolchain,
	planAbsoluteMobileEmulatorInstall
} from '../../../src/mobile/emulatorInstaller';

type Invocation = { command: string[]; input?: string };
type InvocationWithEnv = {
	command: string[];
	env?: Record<string, string | undefined>;
};

describe('mobile emulator installer', () => {
	test('presents a reproducible Android installation plan', () => {
		const plan = planAbsoluteMobileEmulatorInstall('android', {
			env: { ANDROID_HOME: undefined, ANDROID_SDK_ROOT: undefined },
			host: 'linux'
		});

		expect(plan.androidRoot).toEndWith('/.absolutejs/android-sdk');
		expect(plan.steps.map(({ id }) => id)).toEqual([
			'android.command-line-tools',
			'android.sdk-packages',
			'android.avd'
		]);
		expect(plan.steps[0]?.detail).toContain('SHA-256');
	});

	test('uses an existing Android SDK instead of creating a duplicate', () => {
		const plan = planAbsoluteMobileEmulatorInstall('android', {
			env: { ANDROID_HOME: '/opt/android-sdk' },
			host: 'linux'
		});

		expect(plan.androidRoot).toBe('/opt/android-sdk');
	});

	test('installs SDK packages, accepts licenses, and provisions one AVD', async () => {
		const invocations: Invocation[] = [];
		const result = await fixAbsoluteMobileEmulatorToolchain('android', {
			acceptLicenses: true,
			arch: 'x64',
			host: 'linux',
			capture: () => ({ exitCode: 0, stdout: '' }),
			exists: async (path) => path.endsWith('/sdkmanager'),
			log: () => undefined,
			run: async (command, options) => {
				invocations.push({ command, input: options?.input });

				return 0;
			},
			which: (command) => (command === 'java' ? '/usr/bin/java' : null)
		});

		expect(result.completed).toEqual([
			'android.sdk-packages',
			'android.avd'
		]);
		expect(invocations[0]?.command).toContain('--licenses');
		expect(invocations[0]?.input).toStartWith('y\ny\n');
		expect(invocations[1]?.command).toContain(
			'system-images;android-36;google_apis;x86_64'
		);
		expect(invocations[2]?.command).toContain('AbsoluteJS_API_36');
		expect(invocations[2]?.input).toBe('no\n');
	});

	test('does not recreate an existing AbsoluteJS AVD', async () => {
		const invocations: string[][] = [];
		const result = await fixAbsoluteMobileEmulatorToolchain('android', {
			arch: 'arm64',
			host: 'macos',
			capture: () => ({
				exitCode: 0,
				stdout: 'AbsoluteJS_API_36\n'
			}),
			exists: async (path) => path.endsWith('/sdkmanager'),
			log: () => undefined,
			run: async (command) => {
				invocations.push(command);

				return 0;
			},
			which: (command) => (command === 'java' ? '/usr/bin/java' : null)
		});

		expect(result.completed).toEqual(['android.sdk-packages']);
		expect(invocations).toHaveLength(2);
		expect(invocations[1]).toContain(
			'system-images;android-36;google_apis;arm64-v8a'
		);
	});

	test('runs the Windows Android toolchain through WSL interop', async () => {
		const invocations: InvocationWithEnv[] = [];
		await fixAbsoluteMobileEmulatorToolchain('android', {
			arch: 'x64',
			env: { ANDROID_HOME: '/mnt/c/sdk' },
			host: 'wsl',
			capture: () => ({
				exitCode: 0,
				stdout: 'AbsoluteJS_API_36\n'
			}),
			exists: async (path) => path.endsWith('sdkmanager.bat'),
			log: () => undefined,
			run: async (command, options) => {
				invocations.push({ command, env: options?.env });

				return 0;
			},
			which: (command) =>
				command === 'java.exe' ? '/mnt/c/jdk/bin/java.exe' : null
		});

		expect(invocations[0]?.command.slice(0, 4)).toEqual([
			'cmd.exe',
			'/d',
			'/c',
			'C:\\sdk\\cmdline-tools\\latest\\bin\\sdkmanager.bat'
		]);
		expect(invocations[0]?.env?.ANDROID_HOME).toBe('C:\\sdk');
	});

	test('refuses command-line tools whose checksum does not match', async () => {
		expect(
			fixAbsoluteMobileEmulatorToolchain('android', {
				arch: 'x64',
				host: 'linux',
				download: async () => new Uint8Array([1, 2, 3]),
				exists: async () => false,
				log: () => undefined,
				run: async () => 0,
				which: (command) =>
					command === 'java' ? '/usr/bin/java' : null
			})
		).rejects.toThrow('checksum mismatch');
	});

	test('does not offer an iOS installation on non-macOS hosts', async () => {
		expect(
			fixAbsoluteMobileEmulatorToolchain('ios', { host: 'linux' })
		).rejects.toThrow('requires macOS');
	});
});
