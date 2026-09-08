import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'bun:test';
import { normalizeAbsoluteMobileConfig } from '../../src/mobile/config';
import { createAbsoluteMobileUpdateClient } from '../../src/mobile/updateClient';
import {
	advanceAbsoluteMobileUpdateRollout,
	inspectAbsoluteMobileUpdateHealth,
	inspectAbsoluteMobileUpdateRollout,
	publishAbsoluteMobileUpdate,
	rollbackAbsoluteMobileUpdate
} from '../../src/mobile/updatePublisher';
import {
	createAbsoluteMobileUpdateServerPlugin,
	loadAbsoluteMobileUpdateServerModule,
	writeAbsoluteMobileUpdateRegistry
} from '../../src/mobile/updateServer';
import {
	buildAbsoluteMobileUpdate,
	verifyAbsoluteMobileUpdateSignature
} from '../../src/mobile/updateSigning';

const roots: string[] = [];

afterAll(async () => {
	await Promise.all(
		roots.map((root) => rm(root, { force: true, recursive: true }))
	);
});

describe('fresh application mobile update lifecycle', () => {
	test('provisions, publishes, promotes, downloads, activates, and rolls back', async () => {
		const projectRoot = await mkdtemp(
			join(tmpdir(), 'absolute-update-e2e-')
		);
		roots.push(projectRoot);
		await symlink(
			join(process.cwd(), 'node_modules'),
			join(projectRoot, 'node_modules')
		);
		const bundle = join(projectRoot, 'bundle');
		await mkdir(bundle);
		await Promise.all([
			writeFile(join(bundle, 'index.html'), '<main>updated</main>'),
			writeFile(join(bundle, 'app.js'), 'globalThis.updated = true;')
		]);
		const { privateKey, publicKey } = generateKeyPairSync('ec', {
			namedCurve: 'prime256v1'
		});
		const encodedPublicKey = publicKey
			.export({ format: 'der', type: 'spki' })
			.toString('base64');
		await writeAbsoluteMobileUpdateRegistry({
			health: {
				failureRate: 0.2,
				minimumReports: 1,
				secretEnv: 'ABSOLUTE_MOBILE_UPDATE_HEALTH_SECRET'
			},
			projectRoot,
			publicKeys: { main: encodedPublicKey },
			rollout: {
				automatic: false,
				stages: [
					{
						maximumFailureRate: 0.1,
						minimumReports: 1,
						observationMs: 0,
						rollout: 0.05
					},
					{
						maximumFailureRate: 0.1,
						minimumReports: 1,
						observationMs: 0,
						rollout: 1
					}
				]
			},
			storage: 'local'
		});
		const release = await buildAbsoluteMobileUpdate({
			appId: 'com.example.fresh',
			bundleDirectory: bundle,
			channel: 'production',
			classification: 'bug-fix',
			createdAt: new Date('2026-09-07T12:00:00.000Z'),
			keyId: 'main',
			outputDirectory: join(projectRoot, 'updates'),
			privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }),
			runtimeFingerprint: 'a'.repeat(64)
		});
		const { registry } =
			await loadAbsoluteMobileUpdateServerModule(projectRoot);
		await publishAbsoluteMobileUpdate({
			projectRoot,
			publisher: registry,
			releaseDirectory: release.outputDirectory,
			rollout: 0.05
		});
		let installationId = '';
		for (let index = 0; !installationId && index < 10_000; index += 1) {
			const candidate = `${index.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
			const selected = await registry.resolveUpdate({
				appId: release.manifest.appId,
				channel: release.manifest.channel,
				installationId: candidate,
				runtimeFingerprint: release.manifest.runtimeFingerprint
			});
			if (selected?.manifest.releaseId === release.manifest.releaseId)
				installationId = candidate;
		}
		if (!installationId)
			throw new Error('Expected an installation in the staged cohort.');
		const config = normalizeAbsoluteMobileConfig(
			{
				appId: release.manifest.appId,
				appName: 'Fresh',
				platforms: ['android'],
				server: { productionOrigin: 'https://api.example.com' },
				updates: { publicKeys: { main: encodedPublicKey } }
			},
			projectRoot
		);
		const server = await createAbsoluteMobileUpdateServerPlugin(
			config,
			projectRoot
		);
		const { updates } = config;
		if (!updates) throw new Error('Expected normalized mobile updates.');
		const events: string[] = [];
		const client = createAbsoluteMobileUpdateClient({
			config: {
				appId: release.manifest.appId,
				channel: release.manifest.channel,
				currentReleaseId: 'embedded',
				installationId,
				manifestUrl: updates.manifestUrl,
				runtimeFingerprint: release.manifest.runtimeFingerprint
			},
			fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
				server.handle(new Request(input, init))) as typeof fetch,
			store: {
				abort: async (id) => void events.push(`abort:${id}`),
				activate: async (id) => void events.push(`activate:${id}`),
				begin: async ({ releaseId }) =>
					void events.push(`begin:${releaseId}`),
				commit: async ({ releaseId }) =>
					void events.push(`commit:${releaseId}`),
				write: async ({ path }, bytes) =>
					void events.push(`write:${path}:${bytes.byteLength}`)
			},
			verifier: {
				digest: async (bytes) =>
					createHash('sha256').update(bytes).digest('hex'),
				verify: async (manifest) => {
					verifyAbsoluteMobileUpdateSignature(
						manifest,
						publicKey.export({ format: 'pem', type: 'spki' })
					);

					return true;
				}
			}
		});
		const downloaded = await client.download();
		expect(downloaded.kind).toBe('downloaded');
		if (downloaded.kind !== 'downloaded' || !downloaded.healthToken)
			throw new Error('Expected update health capability.');
		await client.report({
			healthToken: downloaded.healthToken,
			kind: 'downloaded',
			releaseId: downloaded.manifest.releaseId,
			transfer: downloaded.transfer
		});
		await client.report({
			healthToken: downloaded.healthToken,
			kind: 'activated',
			releaseId: downloaded.manifest.releaseId
		});
		await expect(
			inspectAbsoluteMobileUpdateHealth({
				appId: release.manifest.appId,
				channel: release.manifest.channel,
				publisher: registry
			})
		).resolves.toMatchObject({
			activated: 1,
			downloaded: 1,
			failures: 0,
			paused: false
		});
		const beforeAdvance = await inspectAbsoluteMobileUpdateRollout({
			appId: release.manifest.appId,
			channel: release.manifest.channel,
			publisher: registry
		});
		const advanced = await advanceAbsoluteMobileUpdateRollout({
			appId: release.manifest.appId,
			channel: release.manifest.channel,
			publisher: registry,
			rollout: 1
		});
		expect(advanced).toMatchObject({
			currentStage: 1,
			promotionId: beforeAdvance?.promotionId,
			rollout: 1,
			status: 'complete'
		});
		await client.activate(release.manifest.releaseId);
		expect(events).toContain(`commit:${release.manifest.releaseId}`);
		expect(events).toContain(`activate:${release.manifest.releaseId}`);

		await rollbackAbsoluteMobileUpdate({
			appId: release.manifest.appId,
			channel: release.manifest.channel,
			publisher: registry
		});
		const rolledBack = await server.handle(
			new Request(updates.manifestUrl, {
				headers: {
					'x-absolute-mobile-app': config.appId,
					'x-absolute-mobile-channel': updates.channel,
					'x-absolute-mobile-installation': installationId,
					'x-absolute-mobile-release': release.manifest.releaseId,
					'x-absolute-mobile-runtime':
						release.manifest.runtimeFingerprint
				}
			})
		);
		expect(rolledBack.status).toBe(204);
	});
});
