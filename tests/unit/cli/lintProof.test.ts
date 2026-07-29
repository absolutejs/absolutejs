import {
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
	verifyLintProof,
	writeLintProof
} from '../../../src/cli/scripts/lintProof';

const temporaryDirectories: string[] = [];

const run = (cwd: string, args: string[]) => {
	const proc = Bun.spawnSync(args, { cwd, stderr: 'pipe', stdout: 'pipe' });
	if (proc.exitCode !== 0) throw new Error(proc.stderr.toString());
};

const project = async () => {
	const cwd = await mkdtemp(join(tmpdir(), 'absolute-lint-proof-test-'));
	temporaryDirectories.push(cwd);
	run(cwd, ['git', 'init', '--quiet']);
	await writeFile(join(cwd, '.gitignore'), '.absolutejs/*\n');
	await writeFile(
		join(cwd, 'package.json'),
		JSON.stringify({ devDependencies: { eslint: '10.0.3' } })
	);
	await mkdir(join(cwd, 'node_modules', 'eslint'), { recursive: true });
	await writeFile(
		join(cwd, 'node_modules', 'eslint', 'package.json'),
		JSON.stringify({ name: 'eslint', version: '10.0.3' })
	);
	await writeFile(
		join(cwd, 'eslint.config.mjs'),
		'export default [{ rules: { eqeqeq: "error" } }];\n'
	);
	await writeFile(join(cwd, 'source.ts'), 'export const value = 1;\n');

	return cwd;
};

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});

describe('lint proof', () => {
	test('accepts only the exact source, command, and lint toolchain', async () => {
		const cwd = await project();
		const command = ['bun', 'run', 'lint:raw'];
		writeLintProof(command, { cwd });
		expect(verifyLintProof(command, { cwd }).valid).toBeTrue();

		await writeFile(join(cwd, 'source.ts'), 'export const value = 2;\n');
		expect(verifyLintProof(command, { cwd })).toEqual({
			reason: 'source tree changed since lint passed',
			valid: false
		});
		await writeFile(join(cwd, 'source.ts'), 'export const value = 1;\n');
		expect(verifyLintProof(['bun', 'run', 'other'], { cwd })).toEqual({
			reason: 'lint command differs from the recorded command',
			valid: false
		});

		await writeFile(
			join(cwd, 'eslint.config.mjs'),
			'export default [{ rules: { eqeqeq: "off" } }];\n'
		);
		expect(verifyLintProof(command, { cwd })).toEqual({
			reason: 'ESLint configuration or toolchain changed',
			valid: false
		});
	});

	test('excludes the proof itself from the source tree', async () => {
		const cwd = await project();
		const command = ['bun', 'run', 'lint:raw'];
		const objectsBefore = await readdir(join(cwd, '.git/objects'), {
			recursive: true
		});
		writeLintProof(command, { cwd });
		const first = JSON.parse(
			await readFile(join(cwd, '.absolutejs/lint-proof.json'), 'utf-8')
		);
		writeLintProof(command, { cwd });
		const second = JSON.parse(
			await readFile(join(cwd, '.absolutejs/lint-proof.json'), 'utf-8')
		);
		expect(second.sourceTree).toBe(first.sourceTree);
		expect(verifyLintProof(command, { cwd }).valid).toBeTrue();
		expect(
			await readdir(join(cwd, '.git/objects'), { recursive: true })
		).toEqual(objectsBefore);
	});
});
