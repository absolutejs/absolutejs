import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readlink, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
	ensureAngularSsrNodeModules,
	resolveAngularSsrOutDir
} from '../../../src/angular/pageHandler';

const tempRoots: string[] = [];

const makeProject = async () => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-angular-isolation-'));
	tempRoots.push(root);
	await mkdir(join(root, 'node_modules'));

	return root;
};

afterEach(async () => {
	await Promise.all(
		tempRoots
			.splice(0)
			.map((root) => rm(root, { force: true, recursive: true }))
	);
});

describe('Angular SSR dependency isolation', () => {
	test('uses a distinct project-local runtime directory', async () => {
		const firstProject = await makeProject();
		const secondProject = await makeProject();
		const firstOutDir = resolveAngularSsrOutDir(firstProject, undefined);
		const secondOutDir = resolveAngularSsrOutDir(secondProject, undefined);

		expect(firstOutDir).toBe(
			join(firstProject, '.absolutejs', 'runtime', 'angular-ssr')
		);
		expect(secondOutDir).not.toBe(firstOutDir);
	});

	test('links each runtime only to its own project dependencies', async () => {
		const projectRoot = await makeProject();
		const outDir = resolveAngularSsrOutDir(projectRoot, undefined);

		await ensureAngularSsrNodeModules(outDir, projectRoot, false);

		const link = join(dirname(dirname(outDir)), 'node_modules');
		expect(resolve(dirname(link), await readlink(link))).toBe(
			join(projectRoot, 'node_modules')
		);
	});

	test('rejects a pre-existing dependency link to another project', async () => {
		const projectRoot = await makeProject();
		const otherProject = await makeProject();
		const outDir = resolveAngularSsrOutDir(projectRoot, undefined);
		const link = join(dirname(dirname(outDir)), 'node_modules');
		await mkdir(dirname(link), { recursive: true });
		await symlink(join(otherProject, 'node_modules'), link, 'dir');

		await expect(
			ensureAngularSsrNodeModules(outDir, projectRoot, false)
		).rejects.toThrow('outside this project');
	});
});
