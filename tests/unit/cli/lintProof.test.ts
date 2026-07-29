import { generateKeyPairSync } from 'node:crypto';
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

const signingKeys = async () => {
	const directory = await mkdtemp(
		join(tmpdir(), 'absolute-lint-proof-keys-')
	);
	temporaryDirectories.push(directory);
	const { privateKey, publicKey } = generateKeyPairSync('ed25519');
	const privateKeyLocation = join(directory, 'private.pem');
	const publicKeyLocation = join(directory, 'public.pem');
	await writeFile(
		privateKeyLocation,
		privateKey.export({ format: 'pem', type: 'pkcs8' })
	);
	await writeFile(
		publicKeyLocation,
		publicKey.export({ format: 'pem', type: 'spki' })
	);

	return { privateKeyLocation, publicKeyLocation };
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

	test('requires a valid attestation from the configured trusted key', async () => {
		const cwd = await project();
		const command = ['bun', 'run', 'lint:raw'];
		const trusted = await signingKeys();
		const untrusted = await signingKeys();
		writeLintProof(command, {
			cwd,
			signingKeyLocation: trusted.privateKeyLocation
		});
		expect(
			verifyLintProof(command, {
				cwd,
				trustedKeyLocation: trusted.publicKeyLocation
			}).valid
		).toBeTrue();
		expect(
			verifyLintProof(command, {
				cwd,
				trustedKeyLocation: untrusted.publicKeyLocation
			})
		).toEqual({
			reason: 'lint proof was signed by an untrusted key',
			valid: false
		});

		const proofLocation = join(cwd, '.absolutejs/lint-proof.json');
		const proof = JSON.parse(await readFile(proofLocation, 'utf-8'));
		proof.createdAt = '2026-01-01T00:00:00.000Z';
		await writeFile(proofLocation, `${JSON.stringify(proof, null, 2)}\n`);
		expect(
			verifyLintProof(command, {
				cwd,
				trustedKeyLocation: trusted.publicKeyLocation
			})
		).toEqual({
			reason: 'lint proof signature is invalid',
			valid: false
		});
	});

	test('fails closed on an unsigned proof when a trusted key is required', async () => {
		const cwd = await project();
		const command = ['bun', 'run', 'lint:raw'];
		const trusted = await signingKeys();
		writeLintProof(command, { cwd });
		expect(verifyLintProof(command, { cwd }).valid).toBeTrue();
		expect(
			verifyLintProof(command, {
				cwd,
				trustedKeyLocation: trusted.publicKeyLocation
			})
		).toEqual({
			reason: 'lint proof is not signed',
			valid: false
		});
	});

	test('refuses to read a private signing key from the repository', async () => {
		const cwd = await project();
		const { privateKey } = generateKeyPairSync('ed25519');
		const privateKeyLocation = join(cwd, 'lint-proof-private.pem');
		await writeFile(
			privateKeyLocation,
			privateKey.export({ format: 'pem', type: 'pkcs8' })
		);
		expect(() =>
			writeLintProof(['bun', 'run', 'lint:raw'], {
				cwd,
				signingKeyLocation: privateKeyLocation
			})
		).toThrow(
			'lint proof signing key must live outside the Git working tree'
		);
	});
});
