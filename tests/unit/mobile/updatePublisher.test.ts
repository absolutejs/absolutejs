import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import type {
	MobileUpdateHealthReport,
	MobileUpdateRolloutReport,
	MobileUpdateStorageReport
} from '@absolutejs/deploy/mobile-update';
import { buildAbsoluteMobileUpdate } from '../../../src/mobile/updateSigning';
import {
	advanceAbsoluteMobileUpdateRollout,
	cancelAbsoluteMobileUpdateRollout,
	inspectAbsoluteMobileUpdateHealth,
	inspectAbsoluteMobileUpdateRollout,
	inspectAbsoluteMobileUpdateStorage,
	promoteAbsoluteMobileUpdate,
	pruneAbsoluteMobileUpdates,
	publishAbsoluteMobileUpdate,
	reconcileAbsoluteMobileUpdateRollout,
	resumeAbsoluteMobileUpdateRollout,
	rollbackAbsoluteMobileUpdate,
	pauseAbsoluteMobileUpdateRollout,
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

	test('validates storage accounting and collection reports', async () => {
		const baseReport: MobileUpdateStorageReport = {
			appId: 'com.example.absolute',
			channelCount: 1,
			contentBlobBytes: 7,
			contentBlobCount: 1,
			reclaimableBytes: 10,
			reclaimableContentBytes: 0,
			releaseBytes: 20,
			releaseCount: 2,
			releases: [],
			totalBytes: 30,
			totalObjectCount: 5,
			untrackedBytes: 10
		};
		const publisher = {
			inspectUpdateStorage: async () => baseReport,
			promoteUpdate: async () => {
				throw new Error('unused');
			},
			pruneUpdates: async () => ({
				...baseReport,
				dryRun: true,
				marked: [],
				reclaimedBytes: 0,
				restored: [],
				swept: [],
				sweptContentBlobs: []
			}),
			publishUpdate: async () => {
				throw new Error('unused');
			},
			rollbackUpdate: async () => {
				throw new Error('unused');
			}
		} satisfies AbsoluteMobileUpdatePublisher;

		await expect(
			inspectAbsoluteMobileUpdateStorage({
				appId: baseReport.appId,
				publisher
			})
		).resolves.toEqual(baseReport);
		await expect(
			pruneAbsoluteMobileUpdates({
				appId: baseReport.appId,
				publisher
			})
		).resolves.toMatchObject({ dryRun: true, reclaimedBytes: 0 });
	});

	test('validates fleet health identity and bounded counters', async () => {
		const report: MobileUpdateHealthReport = {
			activated: 9,
			appId: 'com.example.absolute',
			channel: 'production',
			downloaded: 10,
			downloadFailed: 1,
			failureRate: 0.1,
			failures: 1,
			paused: false,
			promotionId: 'a'.repeat(64),
			quarantined: 0,
			releaseId: `amu_${'b'.repeat(64)}`,
			reportedInstallations: 10,
			rolledBack: 1,
			rollout: 0.25,
			terminalReports: 10,
			transfer: {
				avoidedBytes: 20,
				downloadedBytes: 30,
				durationMs: 40,
				resumedBytes: 5,
				reusedBytes: 15,
				throughputBytesPerSecond: 50
			}
		};
		const publisher = {
			inspectUpdateHealth: async () => report,
			promoteUpdate: async () => {
				throw new Error('unused');
			},
			publishUpdate: async () => {
				throw new Error('unused');
			},
			rollbackUpdate: async () => {
				throw new Error('unused');
			}
		} satisfies AbsoluteMobileUpdatePublisher;
		await expect(
			inspectAbsoluteMobileUpdateHealth({
				appId: report.appId,
				channel: report.channel,
				publisher
			})
		).resolves.toEqual(report);
	});

	test('validates rollout inspection and operator lifecycle receipts', async () => {
		const report: MobileUpdateRolloutReport = {
			activated: 20,
			appId: 'com.example.absolute',
			automatic: false,
			channel: 'production',
			currentStage: 0,
			downloaded: 20,
			downloadFailed: 0,
			enteredAt: '2026-09-08T12:00:00.000Z',
			failureRate: 0,
			failures: 0,
			nextStage: {
				maximumFailureRate: 0.05,
				minimumReports: 100,
				observationMs: 21_600_000,
				rollout: 0.25
			},
			paused: false,
			promotionId: 'a'.repeat(64),
			quarantined: 0,
			releaseId: `amu_${'b'.repeat(64)}`,
			reportedInstallations: 20,
			rolledBack: 0,
			rollout: 0.05,
			status: 'active',
			terminalReports: 20,
			transfer: {
				avoidedBytes: 0,
				downloadedBytes: 100,
				durationMs: 50,
				resumedBytes: 0,
				reusedBytes: 0,
				throughputBytesPerSecond: 2
			}
		};
		const publisher = {
			advanceUpdateRollout: async () => report,
			cancelUpdateRollout: async () => report,
			inspectUpdateRollout: async () => report,
			pauseUpdateRollout: async () => report,
			promoteUpdate: async () => {
				throw new Error('unused');
			},
			publishUpdate: async () => {
				throw new Error('unused');
			},
			reconcileUpdateRollout: async () => report,
			resumeUpdateRollout: async () => report,
			rollbackUpdate: async () => {
				throw new Error('unused');
			}
		} satisfies AbsoluteMobileUpdatePublisher;
		const options = {
			appId: report.appId,
			channel: report.channel,
			publisher
		} satisfies Parameters<typeof inspectAbsoluteMobileUpdateRollout>[0];
		await expect(
			inspectAbsoluteMobileUpdateRollout(options)
		).resolves.toEqual(report);
		await expect(
			advanceAbsoluteMobileUpdateRollout(options)
		).resolves.toEqual(report);
		await expect(
			pauseAbsoluteMobileUpdateRollout(options)
		).resolves.toEqual(report);
		await expect(
			resumeAbsoluteMobileUpdateRollout(options)
		).resolves.toEqual(report);
		await expect(
			cancelAbsoluteMobileUpdateRollout(options)
		).resolves.toEqual(report);
		await expect(
			reconcileAbsoluteMobileUpdateRollout(options)
		).resolves.toEqual(report);
	});

	test('explains how to upgrade a registry without lifecycle methods', async () => {
		const publisher: AbsoluteMobileUpdatePublisher = {
			promoteUpdate: async () => {
				throw new Error('unused');
			},
			publishUpdate: async () => {
				throw new Error('unused');
			},
			rollbackUpdate: async () => {
				throw new Error('unused');
			}
		};

		await expect(
			inspectAbsoluteMobileUpdateStorage({
				appId: 'com.example.absolute',
				publisher
			})
		).rejects.toThrow('provision --force');
	});
});
