import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeAbsoluteMobileConfig } from '../../../src/mobile/config';
import {
	readAbsoluteIosRelease,
	runAbsoluteIosDeviceReleaseAcceptance,
	runAbsoluteIosSimulatorReleaseAcceptance,
	type AbsoluteIosReleaseCommandResult
} from '../../../src/mobile/iosReleaseAcceptance';

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(
		roots
			.splice(0)
			.map((root) => rm(root, { force: true, recursive: true }))
	);
});

const fixture = async (registered = false) => {
	const projectRoot = await mkdtemp(join(tmpdir(), 'absolute-ios-accept-'));
	roots.push(projectRoot);
	const config = normalizeAbsoluteMobileConfig(
		{
			appId: 'com.example.accept',
			appName: 'Accept',
			ios: { version: '2.3.0' },
			platforms: ['ios'],
			server: { productionOrigin: 'https://api.example.com' }
		},
		projectRoot
	);
	const iosRoot = join(config.nativeProjectDirectory, 'ios');
	await mkdir(join(iosRoot, 'App.xcworkspace'), { recursive: true });
	await mkdir(join(iosRoot, 'App.xcodeproj', 'xcshareddata', 'xcschemes'), {
		recursive: true
	});
	await writeFile(
		join(
			iosRoot,
			'App.xcodeproj',
			'xcshareddata',
			'xcschemes',
			'App.xcscheme'
		),
		'<Scheme />\n'
	);
	const releaseRoot = join(projectRoot, 'release');
	await mkdir(releaseRoot, { recursive: true });
	const artifact = 'app-store-ipa';
	const sha256 = createHash('sha256').update(artifact).digest('hex');
	await writeFile(join(releaseRoot, 'App.ipa'), artifact);
	const registeredArtifact = 'registered-ipa';
	const registeredSha256 = createHash('sha256')
		.update(registeredArtifact)
		.digest('hex');
	if (registered)
		await writeFile(
			join(releaseRoot, 'App.registered.ipa'),
			registeredArtifact
		);
	await writeFile(
		join(releaseRoot, 'release.json'),
		JSON.stringify({
			appBuild: 'ambuild_accept',
			appId: config.appId,
			artifact: 'App.ipa',
			buildNumber: 42,
			bytes: Buffer.byteLength(artifact),
			engine: 'capacitor',
			format: 1,
			marketingVersion: '2.3.0',
			platform: 'ios',
			...(registered
				? {
						registeredDevice: {
							artifact: 'App.registered.ipa',
							bytes: Buffer.byteLength(registeredArtifact),
							sha256: registeredSha256
						}
					}
				: {}),
			releaseId: `amobile_ios_${sha256}`,
			runtime: '1',
			sha256,
			signed: true,
			type: 'ipa'
		})
	);

	return {
		config,
		projectRoot,
		release: await readAbsoluteIosRelease(projectRoot, 'release')
	};
};

const success = (stdout = ''): AbsoluteIosReleaseCommandResult => ({
	exitCode: 0,
	stderr: '',
	stdout
});

describe('iOS installed Release acceptance', () => {
	test('builds, installs, and relaunches source-equivalent Simulator evidence', async () => {
		const { config, projectRoot, release } = await fixture();
		const commands: string[][] = [];
		const run = async (command: string[]) => {
			commands.push(command);
			const derivedIndex = command.indexOf('-derivedDataPath');
			if (derivedIndex !== -1) {
				const derived = command.at(derivedIndex + 1);
				if (!derived) throw new Error('missing DerivedData path');
				await mkdir(join(derived, 'Build', 'Products', 'Release.app'), {
					recursive: true
				});
			}
			if (command.includes('get_app_container'))
				return success(
					command.at(-1) === 'data'
						? '/data/container\n'
						: '/app/App.app\n'
				);
			if (command[0] === '/usr/bin/plutil')
				return success(
					JSON.stringify({
						CFBundleIdentifier: config.appId,
						CFBundleShortVersionString: '2.3.0',
						CFBundleVersion: '42'
					})
				);
			if (command.includes('log'))
				return success(
					'AbsoluteJS: Capacitor embedded web content ready; version=2.3.0; build=42'
				);

			return success();
		};
		const result = await runAbsoluteIosSimulatorReleaseAcceptance({
			artifactDirectory: join(projectRoot, 'artifacts'),
			config,
			release,
			run,
			udid: 'SIMULATOR-1'
		});

		expect(result).toMatchObject({
			artifactExactness: 'source-equivalent',
			distribution: 'simulator-release',
			networkUnavailable: 'not-proven',
			status: 'pass',
			target: 'simulator'
		});
		expect(
			commands.filter((command) => command.includes('launch'))
		).toHaveLength(2);
		expect(
			commands.filter((command) => command.includes('log'))
		).toHaveLength(2);
	});

	test('installs the same-archive registered-device export with confirmed offline evidence', async () => {
		const { release } = await fixture(true);
		const commands: string[][] = [];
		const run = async (command: string[]) => {
			commands.push(command);
			if (command[0] === '/usr/bin/ditto') {
				const destination = command.at(-1);
				if (!destination)
					throw new Error('missing extraction destination');
				await mkdir(join(destination, 'Payload', 'Accept.app'), {
					recursive: true
				});
			}

			return success();
		};
		const launches: string[] = [];
		const result = await runAbsoluteIosDeviceReleaseAcceptance({
			device: 'DEVICE-1',
			distribution: 'registered-device',
			networkUnavailableConfirmed: true,
			release,
			run,
			observeLaunch: async ({ marker }) => {
				launches.push(marker);

				return 12;
			}
		});

		expect(result).toMatchObject({
			artifactExactness: 'archive-equivalent',
			distribution: 'registered-device',
			networkUnavailable: 'user-confirmed',
			target: 'device'
		});
		expect(launches).toEqual([
			'Capacitor embedded web content ready; version=2.3.0; build=42',
			'Capacitor embedded web content ready; version=2.3.0; build=42'
		]);
		expect(commands.some((command) => command.includes('install'))).toBe(
			true
		);
	});

	test('proves Apple-processed TestFlight evidence without reinstalling the App Store IPA', async () => {
		const { release } = await fixture();
		const commands: string[][] = [];
		const result = await runAbsoluteIosDeviceReleaseAcceptance({
			device: 'DEVICE-2',
			distribution: 'testflight',
			networkUnavailableConfirmed: true,
			release,
			observeLaunch: async () => 10,
			run: async (command) => {
				commands.push(command);

				return success(
					command.includes('apps')
						? `identifier: ${release.metadata.appId}`
						: ''
				);
			}
		});

		expect(result).toMatchObject({
			artifactExactness: 'store-delivered',
			distribution: 'apple-processed',
			networkUnavailable: 'user-confirmed'
		});
		expect(commands.some((command) => command.includes('install'))).toBe(
			false
		);
	});

	test('rejects physical acceptance without explicit offline confirmation', async () => {
		const { release } = await fixture(true);
		await expect(
			runAbsoluteIosDeviceReleaseAcceptance({
				device: 'DEVICE-3',
				distribution: 'registered-device',
				networkUnavailableConfirmed: false,
				release
			})
		).rejects.toThrow('explicit confirmation');
	});
});
