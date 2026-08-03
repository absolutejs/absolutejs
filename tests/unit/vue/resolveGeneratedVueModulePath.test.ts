import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveGeneratedVueModulePath } from '../../../src/vue/resolveGeneratedVueModulePath';

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = async () => {
	const directory = await mkdtemp(
		join(tmpdir(), 'absolute-vue-page-resolver-')
	);
	temporaryDirectories.push(directory);

	return directory;
};

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});

describe('resolveGeneratedVueModulePath', () => {
	test('keeps the exact manifest asset when stale siblings exist', async () => {
		const directory = await createTemporaryDirectory();
		const currentPath = join(directory, 'Home.current.js');
		const stalePath = join(directory, 'Home.stale.js');
		await writeFile(currentPath, 'current');
		await writeFile(stalePath, 'stale');
		await utimes(stalePath, new Date(), new Date(Date.now() + 60_000));

		expect(await resolveGeneratedVueModulePath(currentPath)).toBe(
			currentPath
		);
	});

	test('uses the newest sibling when an HMR manifest path was pruned', async () => {
		const directory = await createTemporaryDirectory();
		const olderPath = join(directory, 'Home.older.js');
		const newestPath = join(directory, 'Home.newest.js');
		await writeFile(olderPath, 'older');
		await writeFile(newestPath, 'newest');
		const now = Date.now();
		await utimes(olderPath, new Date(now - 60_000), new Date(now - 60_000));
		await utimes(newestPath, new Date(now), new Date(now));

		expect(
			await resolveGeneratedVueModulePath(
				join(directory, 'Home.pruned.js')
			)
		).toBe(newestPath);
	});
});
