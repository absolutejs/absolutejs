import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..', '..', '..');

describe('mobile emulator CLI', () => {
	test('lists remote Macs without requiring a project config', async () => {
		const subprocess = Bun.spawn(
			[
				process.execPath,
				resolve(ROOT, 'src/cli/index.ts'),
				'mobile',
				'remotes',
				'--json'
			],
			{
				cwd: ROOT,
				env: {
					...process.env,
					ABSOLUTE_REMOTE_MAC_PROFILE_PATH: resolve(
						ROOT,
						'.absolutejs-test-missing-remote-profiles.json'
					)
				},
				stderr: 'pipe',
				stdin: 'ignore',
				stdout: 'pipe'
			}
		);
		const [exitCode, stdout] = await Promise.all([
			subprocess.exited,
			new Response(subprocess.stdout).text()
		]);
		expect(exitCode).toBe(0);
		expect(JSON.parse(stdout)).toEqual({ profiles: [] });
	});

	test('refuses a guided install without a TTY or explicit approval', async () => {
		const subprocess = Bun.spawn(
			[
				process.execPath,
				resolve(ROOT, 'src/cli/index.ts'),
				'mobile',
				'doctor',
				'android',
				'--fix'
			],
			{
				cwd: ROOT,
				env: {
					...process.env,
					ANDROID_HOME: resolve(ROOT, '.absolutejs-test-missing-sdk'),
					ANDROID_SDK_ROOT: resolve(
						ROOT,
						'.absolutejs-test-missing-sdk'
					),
					PATH: ''
				},
				stderr: 'pipe',
				stdin: 'ignore',
				stdout: 'pipe'
			}
		);
		const [exitCode, stdout, stderr] = await Promise.all([
			subprocess.exited,
			new Response(subprocess.stdout).text(),
			new Response(subprocess.stderr).text()
		]);

		expect(exitCode).toBe(1);
		expect(stdout).toContain('AbsoluteJS can configure android emulation');
		expect(stderr).toContain('without a TTY');
		expect(stderr).not.toContain('TypeError:');
	});

	test('keeps JSON mode read-only', async () => {
		const subprocess = Bun.spawn(
			[
				process.execPath,
				resolve(ROOT, 'src/cli/index.ts'),
				'mobile',
				'doctor',
				'android',
				'--json'
			],
			{
				cwd: ROOT,
				stderr: 'pipe',
				stdin: 'ignore',
				stdout: 'pipe'
			}
		);
		const [exitCode, stdout] = await Promise.all([
			subprocess.exited,
			new Response(subprocess.stdout).text()
		]);

		expect(exitCode).toBe(0);
		expect(JSON.parse(stdout).checks).toBeArray();
	}, 20_000);

	test('validates an Android conformance port before inspecting the SDK', async () => {
		const subprocess = Bun.spawn(
			[
				process.execPath,
				resolve(ROOT, 'src/cli/index.ts'),
				'mobile',
				'test',
				'android',
				'--config',
				resolve(
					ROOT,
					'tests/fixtures/mobile-native-conformance/absolute.config.ts'
				),
				'--port',
				'0'
			],
			{
				cwd: ROOT,
				stderr: 'pipe',
				stdin: 'ignore',
				stdout: 'pipe'
			}
		);
		const [exitCode, stderr] = await Promise.all([
			subprocess.exited,
			new Response(subprocess.stderr).text()
		]);

		expect(exitCode).toBe(1);
		expect(stderr).toContain('must be a valid TCP port');
		expect(stderr).not.toContain('TypeError:');
	});

	test('validates an iOS conformance port before inspecting Xcode', async () => {
		const subprocess = Bun.spawn(
			[
				process.execPath,
				resolve(ROOT, 'src/cli/index.ts'),
				'mobile',
				'test',
				'ios',
				'--config',
				resolve(
					ROOT,
					'tests/fixtures/mobile-native-conformance/absolute.config.ts'
				),
				'--port',
				'0'
			],
			{
				cwd: ROOT,
				stderr: 'pipe',
				stdin: 'ignore',
				stdout: 'pipe'
			}
		);
		const [exitCode, stderr] = await Promise.all([
			subprocess.exited,
			new Response(subprocess.stderr).text()
		]);

		expect(exitCode).toBe(1);
		expect(stderr).toContain('must be a valid TCP port');
		expect(stderr).not.toContain('TypeError:');
	});

	test('validates native release module flags before building Android', async () => {
		const subprocess = Bun.spawn(
			[
				process.execPath,
				resolve(ROOT, 'src/cli/index.ts'),
				'mobile',
				'publish',
				'android',
				'--registry'
			],
			{
				cwd: ROOT,
				stderr: 'pipe',
				stdin: 'ignore',
				stdout: 'pipe'
			}
		);
		const [exitCode, stderr] = await Promise.all([
			subprocess.exited,
			new Response(subprocess.stderr).text()
		]);

		expect(exitCode).toBe(1);
		expect(stderr).toContain('requires --registry <value>');
		expect(stderr).not.toContain('TypeError:');
	});

	test('requires an explicit Google Play track before building Android', async () => {
		const subprocess = Bun.spawn(
			[
				process.execPath,
				resolve(ROOT, 'src/cli/index.ts'),
				'mobile',
				'publish',
				'android',
				'--play-rollout',
				'0.1'
			],
			{
				cwd: ROOT,
				stderr: 'pipe',
				stdin: 'ignore',
				stdout: 'pipe'
			}
		);
		const [exitCode, stderr] = await Promise.all([
			subprocess.exited,
			new Response(subprocess.stderr).text()
		]);

		expect(exitCode).toBe(1);
		expect(stderr).toContain('requires --play-track <track>');
		expect(stderr).not.toContain('TypeError:');
	});

	test('requires an explicit external group before TestFlight review', async () => {
		const subprocess = Bun.spawn(
			[
				process.execPath,
				resolve(ROOT, 'src/cli/index.ts'),
				'mobile',
				'publish',
				'ios',
				'--testflight-submit-review'
			],
			{
				cwd: ROOT,
				stderr: 'pipe',
				stdin: 'ignore',
				stdout: 'pipe'
			}
		);
		const [exitCode, stderr] = await Promise.all([
			subprocess.exited,
			new Response(subprocess.stderr).text()
		]);

		expect(exitCode).toBe(1);
		expect(stderr).toContain('requires at least one --testflight-group');
		expect(stderr).not.toContain('TypeError:');
	});
});
