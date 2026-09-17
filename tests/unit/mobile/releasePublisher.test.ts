import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import type { AbsoluteAndroidReleaseMetadata } from '../../../src/mobile/androidRelease';
import type { AbsoluteIosReleaseMetadata } from '../../../src/mobile/iosRelease';
import { createAbsoluteMobileReleaseCertification } from '../../../src/mobile/releaseCertification';
import {
	createAbsoluteNativeTestReport,
	writeAbsoluteNativeTestReport
} from '../../../src/mobile/nativeTestReport';
import {
	prepareAbsoluteIosRelease,
	publishAbsoluteAndroidRelease,
	publishAbsoluteIosRelease,
	type PublishAbsoluteAndroidReleaseOptions
} from '../../../src/mobile/releasePublisher';

const roots: string[] = [];

const temporaryRoot = async () => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-release-publisher-'));
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

const metadata = (sha256 = 'a'.repeat(64)) =>
	({
		appBuild: 'ambuild_test',
		appId: 'com.example.absolute',
		artifact: 'app-release.aab',
		bytes: 42,
		engine: 'capacitor',
		format: 1,
		platform: 'android',
		releaseId: `amobile_android_${sha256}`,
		runtime: '1',
		sha256,
		signed: true,
		type: 'aab'
	}) satisfies AbsoluteAndroidReleaseMetadata;

const certificationFor = async (
	projectRoot: string,
	expected: AbsoluteAndroidReleaseMetadata
) => {
	const evidence = join(projectRoot, 'evidence');
	await writeAbsoluteNativeTestReport(
		evidence,
		createAbsoluteNativeTestReport({
			generatedAt: '2026-09-16T12:00:00.000Z',
			manualChecks: [],
			metadata: {
				absolutejsVersion: '0.20.0-beta.107',
				bunVersion: '1.4.0',
				provider: expected.engine
			},
			run: {
				appId: expected.appId,
				durationMs: 100,
				hmrConnected: false,
				platform: 'android',
				release: {
					apksBytes: 50,
					artifactBytes: expected.bytes,
					artifactSha256: expected.sha256,
					embeddedOffline: true,
					engine: expected.engine,
					installMs: 20,
					launchMs: 30,
					relaunchMs: 25,
					releaseId: expected.releaseId,
					signed: true
				},
				status: 'pass',
				targetId: 'emulator',
				targetKind: 'emulator'
			}
		})
	);

	return createAbsoluteMobileReleaseCertification({
		evidencePaths: [evidence],
		generatedAt: '2026-09-16T12:00:00.000Z',
		projectRoot,
		release: { metadata: expected },
		requirement: 'installed'
	});
};

describe('native release publisher modules', () => {
	test('prepares and verifies an App Store Connect TestFlight release', async () => {
		const projectRoot = await temporaryRoot();
		const sha256 = 'c'.repeat(64);
		const expected: AbsoluteIosReleaseMetadata = {
			appBuild: 'ambuild_ios',
			appId: 'com.example.absolute',
			artifact: 'App.ipa',
			buildNumber: 12,
			bytes: 42,
			engine: 'capacitor',
			format: 1,
			marketingVersion: '1.4.0',
			platform: 'ios',
			releaseId: `amobile_ios_${sha256}`,
			runtime: '1',
			sha256,
			signed: true,
			type: 'ipa'
		};
		await writeFile(
			join(projectRoot, 'ios.ts'),
			`export default {
	prepareIosRelease: async () => ({ buildNumber: 12 }),
	publish: async () => ({
		appStoreConnect: {
			receipt: {
				appleAppId: 'apple-1', buildId: 'build-1', buildNumber: 12,
				intent: { groups: ['External'], submitForReview: true },
				marketingVersion: '1.4.0', provider: 'app-store-connect',
				releaseId: ${JSON.stringify(expected.releaseId)}, sha256: ${JSON.stringify(sha256)},
				stage: 'review-submitted'
			},
			reused: false
		},
		record: { metadata: ${JSON.stringify(expected)} }, reused: false
	})
};\n`
		);
		const publisher = await import(
			`${new URL(`file://${join(projectRoot, 'ios.ts')}`).href}`
		);
		expect(
			await prepareAbsoluteIosRelease(publisher.default, {
				buildIdentity: 'identity',
				bundleId: expected.appId,
				marketingVersion: expected.marketingVersion
			})
		).toBe(12);
		const publication = await publishAbsoluteIosRelease({
			appStoreConnect: {
				groups: ['External'],
				submitForReview: true
			},
			modulePath: './ios.ts',
			projectRoot,
			release: {
				metadata: expected,
				releaseRoot: join(projectRoot, 'release')
			}
		});
		expect(publication.appStoreConnect?.receipt.stage).toBe(
			'review-submitted'
		);
	});

	test('publishes the exact Android release through a project-local registry', async () => {
		const projectRoot = await temporaryRoot();
		const capturePath = join(projectRoot, 'capture.json');
		const expected = metadata();
		await writeFile(
			join(projectRoot, 'mobile.release.ts'),
			`export default {
	async publish(options: Record<string, unknown>) {
		await Bun.write(${JSON.stringify(capturePath)}, JSON.stringify(options));
		return {
			channel: { channel: 'internal', releaseId: ${JSON.stringify(expected.releaseId)} },
			record: { metadata: ${JSON.stringify(expected)} },
			reused: false
		};
	}
};
`
		);
		const releaseRoot = join(projectRoot, '.absolutejs', 'release');
		const publication = await publishAbsoluteAndroidRelease({
			channel: 'internal',
			modulePath: './mobile.release.ts',
			projectRoot,
			release: { metadata: expected, releaseRoot }
		});

		expect(publication.record.metadata).toEqual(expected);
		expect(publication.channel?.channel).toBe('internal');
		expect(JSON.parse(await readFile(capturePath, 'utf8'))).toMatchObject({
			channel: 'internal',
			releaseRoot
		});
	});

	test('requires a retained certification receipt for a gated publication', async () => {
		const projectRoot = await temporaryRoot();
		const expected = metadata();
		const certification = await certificationFor(projectRoot, expected);
		await writeFile(
			join(projectRoot, 'certified.ts'),
			`export default {
	async publish(options: Record<string, any>) {
		return {
			certification: {
				certificationId: options.certification.certificationId,
				releaseId: options.certification.release.releaseId,
				requirement: options.certificationRequirement,
				strength: options.certification.strength
			},
			record: { metadata: ${JSON.stringify(expected)} },
			reused: false
		};
	}
};\n`
		);
		const release: PublishAbsoluteAndroidReleaseOptions['release'] = {
			metadata: expected,
			releaseRoot: join(projectRoot, 'release')
		};
		const publication = await publishAbsoluteAndroidRelease({
			certification,
			certificationRequirement: 'installed',
			modulePath: './certified.ts',
			projectRoot,
			release
		});

		expect(publication.certification).toEqual({
			certificationId: certification.certificationId,
			releaseId: expected.releaseId,
			requirement: 'installed',
			strength: 'installed'
		});
		await expect(
			publishAbsoluteAndroidRelease({
				certificationRequirement: 'installed',
				modulePath: './certified.ts',
				projectRoot,
				release
			})
		).rejects.toThrow('requires installed certification');
		await writeFile(
			join(projectRoot, 'drops-certification.ts'),
			`export default { publish: async () => ({ record: { metadata: ${JSON.stringify(expected)} }, reused: false }) };\n`
		);
		await expect(
			publishAbsoluteAndroidRelease({
				certification,
				certificationRequirement: 'installed',
				modulePath: './drops-certification.ts',
				projectRoot,
				release
			})
		).rejects.toThrow('did not retain');
	});

	test('forwards portable verification and requires trusted provenance', async () => {
		const projectRoot = await temporaryRoot();
		const expected = metadata();
		const certification = await certificationFor(projectRoot, expected);
		const verification = {
			bundle: {
				mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json'
			},
			format: 1,
			identity: {
				issuer: 'https://token.actions.githubusercontent.com',
				ref: 'refs/heads/main',
				repository: 'absolutejs/example',
				sha: 'a'.repeat(40),
				workflowPath: '.github/workflows/absolute-mobile.yml'
			},
			kind: 'sigstore-bundle'
		} as const;
		const capturePath = join(projectRoot, 'trusted-capture.json');
		await writeFile(
			join(projectRoot, 'trusted.ts'),
			`export default {
	async publish(options: Record<string, any>) {
		await Bun.write(${JSON.stringify(capturePath)}, JSON.stringify(options));
		return {
			certification: {
				certificationId: options.certification.certificationId,
				releaseId: options.certification.release.releaseId,
				requirement: options.certificationRequirement,
				strength: options.certification.strength,
				provenance: { issuer: 'github', subject: options.certification.release.releaseId, verifiedAt: '2026-09-17T12:00:00.000Z', verificationId: 'sigstore-1' }
			},
			record: { metadata: ${JSON.stringify(expected)} }, reused: false
		};
	}
};\n`
		);
		const publication = await publishAbsoluteAndroidRelease({
			certification,
			certificationRequirement: 'installed',
			certificationVerification: verification,
			modulePath: './trusted.ts',
			projectRoot,
			release: {
				metadata: expected,
				releaseRoot: join(projectRoot, 'release')
			}
		});

		expect(publication.certification?.provenance?.subject).toBe(
			expected.releaseId
		);
		expect(JSON.parse(await readFile(capturePath, 'utf8'))).toMatchObject({
			certificationVerification: verification
		});
	});

	test('rejects registry modules outside the application project', async () => {
		const projectRoot = await temporaryRoot();
		await expect(
			publishAbsoluteAndroidRelease({
				modulePath: '../registry.ts',
				projectRoot,
				release: {
					metadata: metadata(),
					releaseRoot: join(projectRoot, 'release')
				}
			})
		).rejects.toThrow('must remain inside the project');
	});

	test('rejects missing publisher shape and mismatched release identities', async () => {
		const projectRoot = await temporaryRoot();
		await writeFile(
			join(projectRoot, 'invalid.ts'),
			'export default { publish: false };\n'
		);
		await expect(
			publishAbsoluteAndroidRelease({
				modulePath: './invalid.ts',
				projectRoot,
				release: {
					metadata: metadata(),
					releaseRoot: join(projectRoot, 'release')
				}
			})
		).rejects.toThrow('default-export a registry');

		const expected = metadata();
		await writeFile(
			join(projectRoot, 'mismatch.ts'),
			`export default { publish: async () => ({ record: { metadata: ${JSON.stringify(
				metadata('b'.repeat(64))
			)} }, reused: false }) };\n`
		);
		await expect(
			publishAbsoluteAndroidRelease({
				modulePath: './mismatch.ts',
				projectRoot,
				release: {
					metadata: expected,
					releaseRoot: join(projectRoot, 'release')
				}
			})
		).rejects.toThrow('different Android release identity');
	});

	test('forwards and verifies a committed Google Play release intent', async () => {
		const projectRoot = await temporaryRoot();
		const capturePath = join(projectRoot, 'play-capture.json');
		const expected: AbsoluteAndroidReleaseMetadata = {
			...metadata(),
			versionCode: 42
		};
		await writeFile(
			join(projectRoot, 'play.ts'),
			`export default {
	async publish(options: Record<string, unknown>) {
		await Bun.write(${JSON.stringify(capturePath)}, JSON.stringify(options));
		return {
			googlePlay: {
				receipt: {
					intent: { track: 'production' },
					packageName: ${JSON.stringify(expected.appId)},
					provider: 'google-play',
					releaseId: ${JSON.stringify(expected.releaseId)},
					sha256: ${JSON.stringify(expected.sha256)},
					stage: 'committed',
					versionCode: '42'
				},
				reused: false
			},
			record: { metadata: ${JSON.stringify(expected)} },
			reused: false
		};
	}
};
`
		);
		const publication = await publishAbsoluteAndroidRelease({
			googlePlay: {
				status: 'inProgress',
				track: 'production',
				userFraction: 0.1
			},
			modulePath: './play.ts',
			projectRoot,
			release: {
				metadata: expected,
				releaseRoot: join(projectRoot, 'release')
			}
		});

		expect(publication.googlePlay?.receipt.versionCode).toBe('42');
		expect(JSON.parse(await readFile(capturePath, 'utf8'))).toMatchObject({
			googlePlay: {
				status: 'inProgress',
				track: 'production',
				userFraction: 0.1
			}
		});
	});
});
