import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	createAbsoluteMobileCertificationVerification,
	readAbsoluteMobileCertificationVerification,
	readAbsoluteSigstoreBundle,
	writeAbsoluteMobileCertificationVerification
} from '../../../src/mobile/certificationVerification';

const roots: string[] = [];
const temporaryRoot = async () => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-cert-verification-'));
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

describe('mobile certification verification', () => {
	test('creates and round-trips a bounded GitHub Sigstore envelope', async () => {
		const root = await temporaryRoot();
		const bundle: Record<string, unknown> = {
			mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
			verificationMaterial: {}
		};
		const verification = createAbsoluteMobileCertificationVerification(
			bundle,
			{
				GITHUB_REF: 'refs/heads/main',
				GITHUB_REPOSITORY: 'absolutejs/example',
				GITHUB_SHA: 'a'.repeat(40),
				GITHUB_WORKFLOW_REF:
					'absolutejs/example/.github/workflows/absolute-mobile.yml@refs/heads/main'
			}
		);
		const path = await writeAbsoluteMobileCertificationVerification(
			root,
			'.absolutejs/verification.json',
			verification
		);

		expect(
			await readAbsoluteMobileCertificationVerification(
				root,
				'.absolutejs/verification.json'
			)
		).toEqual(verification);
		expect((await readFile(path, 'utf8')).endsWith('\n')).toBe(true);
	});

	test('reads only bounded project-local bundle objects', async () => {
		const root = await temporaryRoot();
		await writeFile(join(root, 'bundle.json'), '{"bundle":true}\n');
		expect(await readAbsoluteSigstoreBundle(root, 'bundle.json')).toEqual({
			bundle: true
		});
		await expect(
			readAbsoluteSigstoreBundle(root, '../bundle.json')
		).rejects.toThrow('inside the project');
		await writeFile(join(root, 'array.json'), '[]\n');
		await expect(
			readAbsoluteSigstoreBundle(root, 'array.json')
		).rejects.toThrow('bundle is invalid');
	});

	test('rejects mutable or incomplete GitHub identities', () => {
		expect(() =>
			createAbsoluteMobileCertificationVerification(
				{},
				{
					GITHUB_REF: 'main',
					GITHUB_REPOSITORY: 'absolutejs/example',
					GITHUB_SHA: 'a'.repeat(40),
					GITHUB_WORKFLOW_REF:
						'absolutejs/example/.github/workflows/absolute-mobile.yml@refs/heads/main'
				}
			)
		).toThrow('verification ref is invalid');
	});
});
