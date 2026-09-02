import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { buildAbsoluteMobileUpdate } from '../../../src/mobile/updateSigning';
import {
	promoteAbsoluteMobileUpdate,
	publishAbsoluteMobileUpdate,
	rollbackAbsoluteMobileUpdate,
	type AbsoluteMobileUpdatePublisher
} from '../../../src/mobile/updatePublisher';

const roots: string[] = [];
const temporaryRoot = async () => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-update-publisher-'));
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

describe('mobile update publisher boundary', () => {
	test('validates publish, promotion, and rollback receipts', async () => {
		const root = await temporaryRoot();
		await Bun.write(join(root, 'bundle/index.html'), 'app');
		const { privateKey } = generateKeyPairSync('ec', {
			namedCurve: 'prime256v1'
		});
		const release = await buildAbsoluteMobileUpdate({
			appId: 'com.example.absolute',
			bundleDirectory: join(root, 'bundle'),
			channel: 'production',
			classification: 'bug-fix',
			createdAt: new Date('2026-09-01T12:00:00.000Z'),
			keyId: 'key-1',
			outputDirectory: join(root, 'updates'),
			privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }),
			runtimeFingerprint: 'a'.repeat(64)
		});
		const publisher: AbsoluteMobileUpdatePublisher = {
			promoteUpdate: async (options) => ({
				...options,
				stage: 'promoted'
			}),
			publishUpdate: async ({ manifest, rollout }) => ({
				appId: manifest.appId,
				channel: manifest.channel,
				releaseId: manifest.releaseId,
				reused: false,
				rollout,
				stage: 'published'
			}),
			rollbackUpdate: async (options) => ({
				...options,
				stage: 'rolled-back'
			})
		};

		expect(
			await publishAbsoluteMobileUpdate({
				projectRoot: root,
				publisher,
				releaseDirectory: release.outputDirectory,
				rollout: 0.05
			})
		).toMatchObject({
			releaseId: release.manifest.releaseId,
			rollout: 0.05
		});
		expect(
			await promoteAbsoluteMobileUpdate({
				appId: release.manifest.appId,
				channel: release.manifest.channel,
				publisher,
				releaseId: release.manifest.releaseId,
				rollout: 1
			})
		).toMatchObject({ stage: 'promoted' });
		expect(
			await rollbackAbsoluteMobileUpdate({
				appId: release.manifest.appId,
				channel: release.manifest.channel,
				publisher
			})
		).toEqual({
			appId: release.manifest.appId,
			channel: release.manifest.channel,
			stage: 'rolled-back'
		});
	});

	test('rejects a provider receipt for another immutable release', async () => {
		await expect(
			promoteAbsoluteMobileUpdate({
				appId: 'com.example.absolute',
				channel: 'production',
				publisher: {
					promoteUpdate: async (options) => ({
						...options,
						releaseId: `amu_${'f'.repeat(64)}`,
						stage: 'promoted'
					}),
					publishUpdate: async () => {
						throw new Error('unused');
					},
					rollbackUpdate: async () => {
						throw new Error('unused');
					}
				},
				releaseId: `amu_${'e'.repeat(64)}`,
				rollout: 0.5
			})
		).rejects.toThrow('different promotion identity');
	});
});
