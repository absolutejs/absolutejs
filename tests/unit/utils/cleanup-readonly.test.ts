import { chmod, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { removeIfExists } from '../../../src/utils/cleanup';

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map(async (root) => {
			await chmod(root, 0o700);
			await chmod(join(root, 'src', 'frontend'), 0o700).catch(
				() => undefined
			);
			await rm(root, { force: true, recursive: true });
		})
	);
});

describe.skipIf(process.platform === 'win32')(
	'generated cleanup on a read-only source tree',
	() => {
		test('accepts an absent legacy generated directory', async () => {
			const root = await mkdtemp(join(tmpdir(), 'absolute-cleanup-'));
			roots.push(root);
			const source = join(root, 'src', 'frontend');
			await mkdir(source, { recursive: true });
			await chmod(source, 0o500);

			await expect(
				removeIfExists(join(source, 'generated'))
			).resolves.toBeUndefined();
		});

		test('still rejects an existing directory that cannot be removed', async () => {
			const root = await mkdtemp(join(tmpdir(), 'absolute-cleanup-'));
			roots.push(root);
			const source = join(root, 'src', 'frontend');
			const generated = join(source, 'generated');
			await mkdir(generated, { recursive: true });
			await chmod(source, 0o500);

			await expect(removeIfExists(generated)).rejects.toMatchObject({
				code: expect.stringMatching(/EACCES|EPERM|EROFS/)
			});
		});
	}
);
