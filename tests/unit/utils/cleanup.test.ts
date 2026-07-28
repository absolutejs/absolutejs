import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup } from '../../../src/utils/cleanup';

const tempDirs: string[] = [];

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		await rm(dir, { force: true, recursive: true });
	}
});

describe('framework cleanup', () => {
	test('removes legacy Angular intermediates without removing source', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-cleanup-'));
		tempDirs.push(root);
		const angularDir = join(root, 'angular');
		const sourceFile = join(angularDir, 'pages', 'home.ts');
		const legacyDirs = ['compiled', 'generated', 'indexes'];

		await mkdir(join(angularDir, 'pages'), { recursive: true });
		await writeFile(sourceFile, 'export const home = true;');
		for (const legacyDir of legacyDirs) {
			const legacyFile = join(angularDir, legacyDir, 'canary.ts');
			await mkdir(join(angularDir, legacyDir), { recursive: true });
			await writeFile(legacyFile, 'throw new Error("stale");');
		}

		await cleanup({
			angularDir,
			preserveAngularGenerated: true
		});

		for (const legacyDir of legacyDirs) {
			expect(await Bun.file(join(angularDir, legacyDir)).exists()).toBe(
				false
			);
		}
		expect(await Bun.file(sourceFile).text()).toBe(
			'export const home = true;'
		);
	});
});
