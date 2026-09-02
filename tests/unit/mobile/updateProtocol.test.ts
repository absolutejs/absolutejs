import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
	buildAbsoluteMobileUpdate,
	verifyAbsoluteMobileUpdateSignature
} from '../../../src/mobile/updateSigning';
import {
	absoluteMobileUpdateSigningPayload,
	parseAbsoluteMobileUpdateManifest,
	unsignedAbsoluteMobileUpdate
} from '../../../src/mobile/updateProtocol';

const roots: string[] = [];
const temporaryRoot = async () => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-update-'));
	roots.push(root);

	return root;
};

afterEach(async () => {
	await Promise.all(
		roots
			.splice(0)
			.map((root) => rm(root, { force: true, recursive: true }))
	);
});

describe('mobile update artifacts', () => {
	test('builds a signed immutable file inventory and verifies it', async () => {
		const root = await temporaryRoot();
		const bundle = join(root, 'bundle');
		await Bun.write(join(bundle, 'index.html'), '<h1>Absolute</h1>');
		await Bun.write(
			join(bundle, 'pages', 'app.js'),
			'export const app = true;'
		);
		const { privateKey, publicKey } = generateKeyPairSync('ec', {
			namedCurve: 'prime256v1'
		});
		const built = await buildAbsoluteMobileUpdate({
			appId: 'com.example.absolute',
			bundleDirectory: bundle,
			channel: 'production',
			classification: 'bug-fix',
			createdAt: new Date('2026-09-01T12:00:00.000Z'),
			keyId: 'production-2026',
			outputDirectory: join(root, 'release'),
			privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }),
			runtimeFingerprint: 'a'.repeat(64)
		});

		expect(built.manifest.releaseId).toMatch(/^amu_[a-f0-9]{64}$/);
		expect(built.manifest.files.map(({ path }) => path)).toEqual([
			'index.html',
			'pages/app.js'
		]);
		expect(
			verifyAbsoluteMobileUpdateSignature(
				built.manifest,
				publicKey.export({ format: 'pem', type: 'spki' })
			)
		).toEqual(built.manifest);
		const publicDer = Uint8Array.from(
			publicKey.export({ format: 'der', type: 'spki' })
		);
		const webKey = await crypto.subtle.importKey(
			'spki',
			publicDer.buffer,
			{ name: 'ECDSA', namedCurve: 'P-256' },
			false,
			['verify']
		);
		expect(
			await crypto.subtle.verify(
				{ hash: 'SHA-256', name: 'ECDSA' },
				webKey,
				Uint8Array.from(
					Buffer.from(built.manifest.signature.value, 'base64')
				).buffer,
				absoluteMobileUpdateSigningPayload(
					unsignedAbsoluteMobileUpdate(built.manifest)
				).buffer
			)
		).toBe(true);
		expect(
			await readFile(
				join(built.outputDirectory, 'files/pages/app.js'),
				'utf8'
			)
		).toContain('app = true');
	});

	test('rejects metadata and file-list tampering', async () => {
		const root = await temporaryRoot();
		const bundle = join(root, 'bundle');
		await writeFile(join(root, 'placeholder'), 'x');
		await Bun.write(join(bundle, 'index.html'), 'safe');
		const { privateKey, publicKey } = generateKeyPairSync('ec', {
			namedCurve: 'prime256v1'
		});
		const { manifest } = await buildAbsoluteMobileUpdate({
			appId: 'com.example.absolute',
			bundleDirectory: bundle,
			channel: 'production',
			classification: 'security',
			createdAt: new Date('2026-09-01T12:00:00.000Z'),
			keyId: 'key-1',
			outputDirectory: join(root, 'release'),
			privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }),
			runtimeFingerprint: 'b'.repeat(64)
		});
		const publicPem = publicKey.export({ format: 'pem', type: 'spki' });

		expect(() =>
			verifyAbsoluteMobileUpdateSignature(
				{ ...manifest, channel: 'attacker' },
				publicPem
			)
		).toThrow('signature verification');
		expect(() =>
			parseAbsoluteMobileUpdateManifest({
				...manifest,
				files: [
					...manifest.files,
					{ ...manifest.files[0], path: '../escape' }
				]
			})
		).toThrow('normalized relative paths');
		expect(unsignedAbsoluteMobileUpdate(manifest)).not.toHaveProperty(
			'signature'
		);
	});
});
