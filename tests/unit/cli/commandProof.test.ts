import { generateKeyPairSync } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
	createCommandSourceTree,
	runCommandProof,
	verifyCommandProof,
	writeCommandProof
} from '../../../src/cli/scripts/commandProof';

/* `absolute proof`: CI accepts a signed proof instead of running a command
 * (a test suite) again, so every way of passing a proof that does not cover
 * exactly what would run is tested here. */

const PROOF = '.absolutejs/proof.json';
const temporaryDirectories: string[] = [];

const git = (cwd: string, args: string[]) => {
	const proc = Bun.spawnSync(['git', ...args], {
		cwd,
		stderr: 'pipe',
		stdout: 'pipe'
	});
	if (proc.exitCode !== 0) throw new Error(proc.stderr.toString());
};

const project = async () => {
	const cwd = await mkdtemp(join(tmpdir(), 'absolute-proof-test-'));
	temporaryDirectories.push(cwd);
	git(cwd, ['init', '--quiet']);
	await writeFile(join(cwd, '.gitignore'), 'node_modules/\n');
	await writeFile(join(cwd, 'source.ts'), 'export const value = 1;\n');
	await writeFile(join(cwd, 'README.md'), 'notes\n');

	return cwd;
};

const keys = async () => {
	const directory = await mkdtemp(join(tmpdir(), 'absolute-proof-keys-'));
	temporaryDirectories.push(directory);
	const { privateKey, publicKey } = generateKeyPairSync('ed25519');
	const signing = join(directory, 'private.pem');
	const trusted = join(directory, 'public.pem');
	await writeFile(
		signing,
		privateKey.export({ format: 'pem', type: 'pkcs8' })
	);
	await writeFile(trusted, publicKey.export({ format: 'pem', type: 'spki' }));

	return { signing, trusted };
};

const readProof = async (cwd: string) => {
	const proof: Record<string, unknown> = JSON.parse(
		await readFile(join(cwd, PROOF), 'utf-8')
	);

	return proof;
};

const rewriteProof = async (
	cwd: string,
	change: (proof: Record<string, unknown>) => void
) => {
	const proof = await readProof(cwd);
	change(proof);
	await writeFile(join(cwd, PROOF), `${JSON.stringify(proof, null, 2)}\n`);
};

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});

describe('a signed command proof', () => {
	const command = ['bun', 'test'];

	test('covers the whole tree, the exact command and the exact Bun', async () => {
		const cwd = await project();
		const { signing, trusted } = await keys();
		writeCommandProof(
			command,
			createCommandSourceTree(cwd, PROOF),
			signing,
			{
				cwd,
				proofLocation: PROOF
			}
		);
		const verifyHere = (cmd = command) =>
			verifyCommandProof(cmd, trusted, { cwd, proofLocation: PROOF });

		expect(verifyHere().valid).toBeTrue();
		expect((await readProof(cwd)).bun).toBe(Bun.version);

		// Any file can change a test result, so any file invalidates it: a
		// README too (unlike a lint proof, which scopes to its targets).
		await writeFile(join(cwd, 'README.md'), 'changed\n');
		expect(verifyHere()).toEqual({
			reason: 'source tree changed since the command passed',
			valid: false
		});
		await writeFile(join(cwd, 'README.md'), 'notes\n');
		await writeFile(join(cwd, 'new-file.ts'), 'export {};\n');
		expect(verifyHere().valid).toBeFalse();
		await rm(join(cwd, 'new-file.ts'));
		expect(verifyHere().valid).toBeTrue();

		expect(verifyHere(['bun', 'test', 'only-some'])).toEqual({
			reason: 'command differs from the recorded command',
			valid: false
		});
	});

	test('a proof from another Bun is refused, and its version cannot be edited', async () => {
		const cwd = await project();
		const { signing, trusted } = await keys();
		writeCommandProof(
			command,
			createCommandSourceTree(cwd, PROOF),
			signing,
			{
				cwd,
				proofLocation: PROOF
			}
		);
		await rewriteProof(cwd, (proof) => {
			proof.bun = '1.0.0';
		});
		expect(
			verifyCommandProof(command, trusted, { cwd, proofLocation: PROOF })
		).toEqual({
			reason: `recorded on Bun 1.0.0, verifying on Bun ${Bun.version}`,
			valid: false
		});
		// Put the version back but leave another field edited: the signature
		// covers every field.
		await rewriteProof(cwd, (proof) => {
			proof.bun = Bun.version;
			proof.createdAt = '2020-01-01T00:00:00.000Z';
		});
		expect(
			verifyCommandProof(command, trusted, { cwd, proofLocation: PROOF })
		).toEqual({
			reason: 'command proof signature is invalid',
			valid: false
		});
	});

	test('only the trusted key is accepted, and a lint signature never passes', async () => {
		const cwd = await project();
		const trustedKeys = await keys();
		const otherKeys = await keys();
		writeCommandProof(
			command,
			createCommandSourceTree(cwd, PROOF),
			otherKeys.signing,
			{ cwd, proofLocation: PROOF }
		);
		expect(
			verifyCommandProof(command, trustedKeys.trusted, {
				cwd,
				proofLocation: PROOF
			})
		).toEqual({
			reason: 'command proof was signed by an untrusted key',
			valid: false
		});
		await rewriteProof(cwd, (proof) => {
			delete proof.attestation;
		});
		expect(
			verifyCommandProof(command, trustedKeys.trusted, {
				cwd,
				proofLocation: PROOF
			})
		).toEqual({ reason: 'command proof is not signed', valid: false });
	});

	test('committing the proof does not invalidate it', async () => {
		const cwd = await project();
		const { signing, trusted } = await keys();
		git(cwd, ['add', '-A']);
		git(cwd, [
			'-c',
			'user.email=t@t',
			'-c',
			'user.name=t',
			'commit',
			'-qm',
			'code'
		]);
		writeCommandProof(
			command,
			createCommandSourceTree(cwd, PROOF),
			signing,
			{
				cwd,
				proofLocation: PROOF
			}
		);
		git(cwd, ['add', '-A']);
		git(cwd, [
			'-c',
			'user.email=t@t',
			'-c',
			'user.name=t',
			'commit',
			'-qm',
			'proof'
		]);

		expect(
			verifyCommandProof(command, trusted, { cwd, proofLocation: PROOF })
				.valid
		).toBeTrue();
	});

	test('the signing key may not live inside the repository', async () => {
		const cwd = await project();
		const { privateKey } = generateKeyPairSync('ed25519');
		await writeFile(
			join(cwd, 'key.pem'),
			privateKey.export({ format: 'pem', type: 'pkcs8' })
		);
		expect(() =>
			writeCommandProof(command, 'tree', join(cwd, 'key.pem'), {
				cwd,
				proofLocation: PROOF
			})
		).toThrow(
			'command proof signing key must live outside the Git working tree'
		);
	});
});

describe('absolute proof run', () => {
	const args = (signing: string, ...command: string[]) => [
		'run',
		'--proof',
		PROOF,
		'--signing-key',
		signing,
		'--',
		...command
	];

	test('signs only after the command passes', async () => {
		const cwd = await project();
		const { signing, trusted } = await keys();

		expect(
			await runCommandProof(
				args(signing, 'bun', '-e', 'process.exit(3)'),
				cwd
			)
		).toBe(3);
		expect(existsSync(join(cwd, PROOF))).toBeFalse();

		expect(
			await runCommandProof(args(signing, 'bun', '-e', '0'), cwd)
		).toBe(0);
		expect(
			await runCommandProof(
				[
					'verify',
					'--proof',
					PROOF,
					'--trusted-key',
					trusted,
					'--',
					'bun',
					'-e',
					'0'
				],
				cwd
			)
		).toBe(0);
	});

	test('refuses to sign when the command changed the tree it was meant to check', async () => {
		const cwd = await project();
		const { signing } = await keys();
		const edit = `require("fs").writeFileSync(${JSON.stringify(join(cwd, 'source.ts'))}, "export const value = 2;\\n")`;

		expect(
			await runCommandProof(args(signing, 'bun', '-e', edit), cwd)
		).toBe(1);
		expect(existsSync(join(cwd, PROOF))).toBeFalse();
	});

	test('run needs a signing key and verify needs a trusted key', async () => {
		const cwd = await project();
		expect(
			await runCommandProof(['run', '--', 'bun', '-e', '0'], cwd)
		).toBe(2);
		expect(
			await runCommandProof(['verify', '--', 'bun', '-e', '0'], cwd)
		).toBe(2);
		expect(await runCommandProof(['run', '--signing-key'], cwd)).toBe(2);
	});
});
