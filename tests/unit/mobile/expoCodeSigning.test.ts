import { afterEach, describe, expect, test } from 'bun:test';
import { access, mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	createPrivateKey,
	createPublicKey,
	X509Certificate
} from 'node:crypto';
import { generateAbsoluteExpoCodeSigning } from '../../../src/mobile/expoCodeSigning';

const roots: string[] = [];

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
});
