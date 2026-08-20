import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..', '..', '..');

describe('mobile emulator CLI', () => {
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
	});
});
