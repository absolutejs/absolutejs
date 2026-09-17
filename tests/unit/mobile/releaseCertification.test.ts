import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AbsoluteAndroidRelease } from '../../../src/mobile/androidReleaseAcceptance';
import type { AbsoluteIosRelease } from '../../../src/mobile/iosReleaseAcceptance';
import { normalizeAbsoluteMobileConfig } from '../../../src/mobile/config';
import {
	createAbsoluteMobileReleaseCertification,
	readAbsoluteMobileReleaseCertification,
	renderAbsoluteMobileReleaseCertification,
	resolveAbsoluteMobileCertificationRequirement,
	verifyAbsoluteMobileReleaseCertification,
	writeAbsoluteMobileReleaseCertification
} from '../../../src/mobile/releaseCertification';
import {
	createAbsoluteNativeTestReport,
	writeAbsoluteNativeTestReport,
	type AbsoluteNativeAutomatedRun
} from '../../../src/mobile/nativeTestReport';

const ANDROID_SHA = 'a'.repeat(64);
const IOS_SHA = 'b'.repeat(64);

const androidRelease = (root: string): AbsoluteAndroidRelease => ({
	artifactPath: join(root, 'release', 'app-release.aab'),
	metadata: {
		appBuild: 'web-build-android',
		appId: 'com.example.mobile',
		artifact: 'app-release.aab',
		bytes: 1234,
		engine: 'capacitor',
		format: 1,
		platform: 'android',
		releaseId: `amobile_android_${ANDROID_SHA}`,
		runtime: 'android-runtime-fingerprint',
		sha256: ANDROID_SHA,
		signed: true,
		type: 'aab',
		versionCode: 42
	},
	metadataPath: join(root, 'release', 'release.json'),
	releaseRoot: join(root, 'release')
});

const iosRelease = (root: string): AbsoluteIosRelease => ({
	artifactPath: join(root, 'release', 'App.ipa'),
	metadata: {
		appBuild: 'web-build-ios',
		appId: 'com.example.mobile',
		artifact: 'App.ipa',
		buildNumber: 73,
		bytes: 4321,
		engine: 'capacitor',
		format: 1,
		marketingVersion: '2.4.0',
		platform: 'ios',
		releaseId: `amobile_ios_${IOS_SHA}`,
		runtime: 'ios-runtime-fingerprint',
		sha256: IOS_SHA,
		signed: true,
		type: 'ipa'
	},
	metadataPath: join(root, 'release', 'release.json'),
	releaseRoot: join(root, 'release')
});

const writeReport = async (
	root: string,
	name: string,
	provider: 'capacitor' | 'expo',
	run: AbsoluteNativeAutomatedRun
) => {
	const directory = join(root, name);
	await writeAbsoluteNativeTestReport(
		directory,
		createAbsoluteNativeTestReport({
			generatedAt: '2026-09-16T12:00:00.000Z',
			manualChecks: [],
			metadata: {
				absolutejsVersion: '0.20.0-beta.107',
				bunVersion: '1.4.0',
				provider
			},
			run
		})
	);

	return directory;
};

const androidRun = (
	release: AbsoluteAndroidRelease
): AbsoluteNativeAutomatedRun => ({
	appId: release.metadata.appId,
	durationMs: 100,
	hmrConnected: false,
	platform: 'android',
	release: {
		apksBytes: 1000,
		artifactBytes: release.metadata.bytes,
		artifactSha256: release.metadata.sha256,
		embeddedOffline: true,
		engine: release.metadata.engine,
		installMs: 20,
		launchMs: 30,
		relaunchMs: 25,
		releaseId: release.metadata.releaseId,
		signed: release.metadata.signed
	},
	status: 'pass',
	targetId: 'android-emulator',
	targetKind: 'emulator'
});

const iosArtifactExactness = (strength: 'device' | 'simulator' | 'store') => {
	if (strength === 'simulator') return 'source-equivalent' as const;
	if (strength === 'device') return 'archive-equivalent' as const;

	return 'store-delivered' as const;
};

const iosDistribution = (strength: 'device' | 'simulator' | 'store') => {
	if (strength === 'simulator') return 'simulator-release' as const;
	if (strength === 'device') return 'registered-device' as const;

	return 'apple-processed' as const;
};

const iosRun = (
	release: AbsoluteIosRelease,
	strength: 'device' | 'simulator' | 'store'
): AbsoluteNativeAutomatedRun => ({
	appId: release.metadata.appId,
	durationMs: 100,
	hmrConnected: false,
	iosRelease: {
		artifactBytes: release.metadata.bytes,
		artifactExactness: iosArtifactExactness(strength),
		artifactSha256: release.metadata.sha256,
		distribution: iosDistribution(strength),
		embeddedLocal: true,
		engine: release.metadata.engine,
		installMs: 20,
		launchMs: 30,
		networkUnavailable:
			strength === 'simulator' ? 'not-proven' : 'user-confirmed',
		relaunchMs: 25,
		releaseId: release.metadata.releaseId,
		remote: true,
		signed: release.metadata.signed
	},
	platform: 'ios',
	status: 'pass',
	targetId: strength === 'simulator' ? 'ios-simulator' : 'physical-device',
	targetKind: strength === 'simulator' ? 'simulator' : 'device'
});

describe('mobile release certification', () => {
	test('resolves the strongest configured promotion policy', () => {
		const config = normalizeAbsoluteMobileConfig(
			{
				appId: 'com.example.mobile',
				appName: 'Mobile',
				release: {
					certification: {
						channels: { beta: { ios: 'device' } },
						googlePlayTracks: { beta: 'installed' }
					}
				},
				server: { productionOrigin: 'https://example.com' }
			},
			'/workspace'
		);

		expect(
			resolveAbsoluteMobileCertificationRequirement(config, {
				channel: 'production',
				platform: 'ios'
			})
		).toBe('store');
		expect(
			resolveAbsoluteMobileCertificationRequirement(config, {
				channel: 'beta',
				platform: 'ios'
			})
		).toBe('device');
		expect(
			resolveAbsoluteMobileCertificationRequirement(config, {
				googlePlayTrack: 'beta',
				platform: 'android'
			})
		).toBe('installed');
		expect(
			resolveAbsoluteMobileCertificationRequirement(config, {
				channel: 'preview',
				platform: 'android'
			})
		).toBeUndefined();
	});

	test('certifies, persists, and re-verifies exact Android installed evidence', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-certification-'));
		const release = androidRelease(root);
		const evidence = await writeReport(
			root,
			'android-report',
			'capacitor',
			androidRun(release)
		);
		const certification = await createAbsoluteMobileReleaseCertification({
			evidencePaths: [evidence],
			projectRoot: root,
			release
		});
		const repeated = await createAbsoluteMobileReleaseCertification({
			evidencePaths: [evidence],
			projectRoot: root,
			release
		});

		expect(certification).toMatchObject({
			requirement: 'installed',
			status: 'certified',
			strength: 'installed'
		});
		expect(certification.certificationId).toMatch(
			/^amobile_cert_[a-f0-9]{64}$/u
		);
		expect(repeated.certificationId).toBe(certification.certificationId);
		expect(certification.generatedAt).toBe('2026-09-16T12:00:00.000Z');
		const paths = await writeAbsoluteMobileReleaseCertification(
			root,
			certification
		);
		const loaded = await readAbsoluteMobileReleaseCertification(
			root,
			paths.directory
		);
		expect(
			verifyAbsoluteMobileReleaseCertification(
				loaded.certification,
				release,
				'installed'
			)
		).toEqual(certification);
		expect(await readFile(paths.markdownPath, 'utf8')).not.toContain(root);
	});

	test('keeps Simulator evidence below device and store policy', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-certification-'));
		const release = iosRelease(root);
		const evidence = await writeReport(
			root,
			'ios-simulator-report',
			'capacitor',
			iosRun(release, 'simulator')
		);
		const simulator = await createAbsoluteMobileReleaseCertification({
			evidencePaths: [evidence],
			generatedAt: '2026-09-16T12:01:00.000Z',
			projectRoot: root,
			release,
			requirement: 'simulator'
		});

		expect(simulator.strength).toBe('simulator');
		expect(simulator.evidence[0]?.networkUnavailable).toBe('not-proven');
		expect(
			createAbsoluteMobileReleaseCertification({
				evidencePaths: [evidence],
				projectRoot: root,
				release,
				requirement: 'device'
			})
		).rejects.toThrow('does not satisfy required device');
		expect(
			createAbsoluteMobileReleaseCertification({
				evidencePaths: [evidence],
				projectRoot: root,
				release,
				requirement: 'store'
			})
		).rejects.toThrow('does not satisfy required store');
	});

	test('accepts archive-equivalent device proof and lets store proof satisfy every iOS tier', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-certification-'));
		const release = iosRelease(root);
		const deviceEvidence = await writeReport(
			root,
			'ios-device-report',
			'capacitor',
			iosRun(release, 'device')
		);
		const storeEvidence = await writeReport(
			root,
			'ios-store-report',
			'capacitor',
			iosRun(release, 'store')
		);
		const device = await createAbsoluteMobileReleaseCertification({
			evidencePaths: [deviceEvidence],
			projectRoot: root,
			release,
			requirement: 'device'
		});
		const store = await createAbsoluteMobileReleaseCertification({
			evidencePaths: [deviceEvidence, storeEvidence],
			projectRoot: root,
			release,
			requirement: 'store'
		});

		expect(device.strength).toBe('device');
		expect(store.strength).toBe('store');
		expect(
			verifyAbsoluteMobileReleaseCertification(store, release, 'device')
		).toEqual(store);
	});

	test('rejects edited release identity and automated acceptance results', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-certification-'));
		const release = androidRelease(root);
		const evidence = await writeReport(
			root,
			'android-report',
			'capacitor',
			androidRun(release)
		);
		const reportPath = join(evidence, 'report.json');
		const report = JSON.parse(await readFile(reportPath, 'utf8'));
		report.run.release.artifactSha256 = 'c'.repeat(64);
		await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
		expect(
			createAbsoluteMobileReleaseCertification({
				evidencePaths: [evidence],
				projectRoot: root,
				release
			})
		).rejects.toThrow('does not match the immutable release identity');

		report.run.release.artifactSha256 = ANDROID_SHA;
		report.automatedChecks.find(
			(check: { id: string }) => check.id === 'AUTO-RELEASE-OFFLINE-01'
		).result = 'FAIL';
		await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
		expect(
			createAbsoluteMobileReleaseCertification({
				evidencePaths: [evidence],
				projectRoot: root,
				release
			})
		).rejects.toThrow('does not satisfy AUTO-RELEASE-OFFLINE-01');
	});

	test('rejects impossible iOS evidence-strength combinations', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-certification-'));
		const release = iosRelease(root);
		const run = iosRun(release, 'simulator');
		run.targetKind = 'device';
		const evidence = await writeReport(
			root,
			'ios-report',
			'capacitor',
			run
		);
		expect(
			createAbsoluteMobileReleaseCertification({
				evidencePaths: [evidence],
				projectRoot: root,
				release,
				requirement: 'simulator'
			})
		).rejects.toThrow('invalid target, distribution, exactness');
	});

	test('invalidates certification after runtime, version, or embedded build changes', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-certification-'));
		const release = iosRelease(root);
		const evidence = await writeReport(
			root,
			'ios-report',
			'capacitor',
			iosRun(release, 'store')
		);
		const certification = await createAbsoluteMobileReleaseCertification({
			evidencePaths: [evidence],
			generatedAt: '2026-09-16T12:01:00.000Z',
			projectRoot: root,
			release,
			requirement: 'store'
		});
		const changed = iosRelease(root);
		changed.metadata = {
			...changed.metadata,
			appBuild: 'different-web-build'
		};
		expect(() =>
			verifyAbsoluteMobileReleaseCertification(
				certification,
				changed,
				'store'
			)
		).toThrow('invalidated by a release identity');
	});

	test('detects certification JSON tampering through its content digest', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-certification-'));
		const release = androidRelease(root);
		const evidence = await writeReport(
			root,
			'android-report',
			'capacitor',
			androidRun(release)
		);
		const certification = await createAbsoluteMobileReleaseCertification({
			evidencePaths: [evidence],
			generatedAt: '2026-09-16T12:01:00.000Z',
			projectRoot: root,
			release
		});
		const paths = await writeAbsoluteMobileReleaseCertification(
			root,
			certification
		);
		const value = JSON.parse(await readFile(paths.jsonPath, 'utf8'));
		value.strength = 'store';
		await writeFile(paths.jsonPath, `${JSON.stringify(value, null, 2)}\n`);
		expect(
			readAbsoluteMobileReleaseCertification(root, paths.jsonPath)
		).rejects.toThrow();
		expect(
			writeAbsoluteMobileReleaseCertification(root, certification)
		).rejects.toThrow('already exists with different content');
	});

	test('keeps evidence and output paths inside the project', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-certification-'));
		const other = await mkdtemp(join(tmpdir(), 'absolute-certification-'));
		const release = androidRelease(root);
		const evidence = await writeReport(
			other,
			'android-report',
			'capacitor',
			androidRun(release)
		);
		expect(
			createAbsoluteMobileReleaseCertification({
				evidencePaths: [evidence],
				projectRoot: root,
				release
			})
		).rejects.toThrow('must remain inside the project');
	});

	test('renders only bounded release and evidence facts', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-certification-'));
		const release = iosRelease(root);
		const evidence = await writeReport(
			root,
			'ios-report',
			'capacitor',
			iosRun(release, 'store')
		);
		const certification = await createAbsoluteMobileReleaseCertification({
			evidencePaths: [evidence],
			generatedAt: '2026-09-16T12:01:00.000Z',
			projectRoot: root,
			release,
			requirement: 'store'
		});
		const markdown =
			renderAbsoluteMobileReleaseCertification(certification);

		expect(markdown).toContain('Evidence strength: store');
		expect(markdown).toContain('2.4.0 (73)');
		expect(markdown).not.toContain(root);
		expect(markdown).not.toContain('physical-device');
	});
});
