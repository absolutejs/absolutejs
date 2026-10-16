import { afterEach, describe, expect, test } from 'bun:test';
import {
	access,
	mkdtemp,
	mkdir,
	readFile,
	rm,
	stat,
	symlink
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
	createPrivateKey,
	createPublicKey,
	X509Certificate
} from 'node:crypto';
import { generateAbsoluteExpoCodeSigning } from '../../../src/mobile/expoCodeSigning';

const roots: string[] = [];
const SIGNING_PACKAGE = '@expo/code-signing-certificates';

// The package is an optional peer the application installs; link the
// repository's copy in as an installed dependency.
const installSigningPackage = async (projectRoot: string) => {
	const installed = join(projectRoot, 'node_modules', SIGNING_PACKAGE);
	await mkdir(dirname(installed), { recursive: true });
	await symlink(
		resolve(import.meta.dir, '../../../node_modules', SIGNING_PACKAGE),
		installed
	);
};

afterEach(async () => {
	await Promise.all(
		roots
			.splice(0)
			.map((root) => rm(root, { force: true, recursive: true }))
	);
});

describe('Expo code-signing provisioning', () => {
	test('generates a matching certificate while keeping private material outside the project', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-expo-signing-'));
		roots.push(root);
		const projectRoot = join(root, 'application');
		const privateKeyPath = join(root, 'secrets', 'private-key.pem');
		await mkdir(projectRoot);
		await installSigningPackage(projectRoot);
		const result = await generateAbsoluteExpoCodeSigning({
			certificatePath: 'mobile/code-signing/certificate.pem',
			commonName: 'AbsoluteJS Test Updates',
			privateKeyPath,
			projectRoot,
			validityYears: 2
		});
		const [certificatePem, privateKeyPem, privateMetadata] =
			await Promise.all([
				readFile(result.certificatePath, 'utf8'),
				readFile(result.privateKeyPath, 'utf8'),
				stat(result.privateKeyPath)
			]);
		const certificate = new X509Certificate(certificatePem);
		const privatePublicKey = createPublicKey(
			createPrivateKey(privateKeyPem)
		).export({ format: 'der', type: 'spki' });

		expect(certificate.publicKey.asymmetricKeyType).toBe('rsa');
		expect(certificate.issuer).toBe(certificate.subject);
		expect(certificate.verify(certificate.publicKey)).toBe(true);
		expect(
			certificate.publicKey.export({ format: 'der', type: 'spki' })
		).toEqual(privatePublicKey);
		expect(privateMetadata.mode & 0o777).toBe(0o600);
		expect(result.validityNotAfter).toMatch(/^20\d\d-/u);
		await expect(access(result.publicKeyPath)).resolves.toBeNull();
		await expect(
			generateAbsoluteExpoCodeSigning({
				certificatePath: 'mobile/code-signing/certificate.pem',
				commonName: 'AbsoluteJS Test Updates',
				privateKeyPath,
				projectRoot
			})
		).rejects.toThrow('Refusing to overwrite');
	});

	test('refuses to place private keys in the application', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-expo-signing-'));
		roots.push(root);
		await expect(
			generateAbsoluteExpoCodeSigning({
				certificatePath: 'certificate.pem',
				commonName: 'AbsoluteJS Test Updates',
				privateKeyPath: 'private-key.pem',
				projectRoot: root
			})
		).rejects.toThrow('outside the project');
	});

	test('explains how to install the signing package when the application lacks it', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-expo-signing-'));
		roots.push(root);
		const projectRoot = join(root, 'application');
		await mkdir(projectRoot);
		await expect(
			generateAbsoluteExpoCodeSigning({
				certificatePath: 'certificate.pem',
				commonName: 'AbsoluteJS Test Updates',
				privateKeyPath: join(root, 'secrets', 'private-key.pem'),
				projectRoot
			})
		).rejects.toThrow(`bun add --dev ${SIGNING_PACKAGE}@0.0.6`);
	});
});
