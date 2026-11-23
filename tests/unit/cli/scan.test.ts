import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = new URL('../../../src/cli/index.ts', import.meta.url).pathname;

describe('absolute scan', () => {
	test('reads an exported project without loading its configuration', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'absolute-cli-scan-'));
		try {
			await writeFile(
				join(directory, 'absolute.config.ts'),
				'throw new Error("configuration was executed");'
			);
			const result = Bun.spawnSync(
				[process.execPath, cli, 'scan', '--path', directory, '--json'],
				{ cwd: directory }
			);
			expect(result.exitCode).toBe(0);
			expect(JSON.parse(result.stdout.toString())).toMatchObject({
				complete: true,
				counts: { severe: 0 }
			});
		} finally {
			await rm(directory, { force: true, recursive: true });
		}
	});
});
