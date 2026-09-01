import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	buildAbsoluteIosRelease,
	installAbsoluteIosRelease,
	requireAbsoluteIosReleaseMetadata,
	resolveAbsoluteIosXcodeProject
} from '../../../src/mobile/iosRelease';
import {
	normalizeAbsoluteMobileConfig,
	type NormalizedAbsoluteMobileConfig
} from '../../../src/mobile/config';

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(
		roots
			.splice(0)
			.map((root) => rm(root, { force: true, recursive: true }))
	);
});

const fixture = async () => {
	const projectRoot = await mkdtemp(join(tmpdir(), 'absolute-ios-release-'));
	roots.push(projectRoot);
	const config = normalizeAbsoluteMobileConfig(
		{
			appId: 'com.example.release',
			appName: 'Release',
			ios: { version: '1.4.0' },
			platforms: ['ios'],
			server: { productionOrigin: 'https://api.example.com' }
		},
		projectRoot
	);
	await mkdir(config.bundleDirectory, { recursive: true });
	await writeFile(
		join(config.bundleDirectory, 'absolute-mobile-manifest.json'),
		`${JSON.stringify({ appBuild: 'ambuild_fixture', appId: config.appId, runtime: '1' })}\n`
	);
	const iosRoot = join(config.nativeProjectDirectory, 'ios');
	await mkdir(join(iosRoot, 'App', 'App.xcworkspace'), { recursive: true });
	await mkdir(
		join(iosRoot, 'App', 'App.xcodeproj', 'xcshareddata', 'xcschemes'),
		{ recursive: true }
	);
	await writeFile(
		join(
			iosRoot,
			'App',
			'App.xcodeproj',
			'xcshareddata',
			'xcschemes',
			'App.xcscheme'
		),
		'<Scheme />\n'
	);
	await writeFile(join(iosRoot, 'App', 'Podfile.lock'), 'Capacitor 8\n');
	const commands: string[][] = [];
	const run = async (command: string[]) => {
		commands.push(command);
		const archiveIndex = command.indexOf('-archivePath');
		if (archiveIndex !== -1 && command.includes('archive')) {
			const archive = command.at(archiveIndex + 1);
			if (!archive) throw new Error('missing archive path');
			await mkdir(join(archive, 'Products', 'Applications', 'App.app'), {
				recursive: true
			});
		}
		const exportIndex = command.indexOf('-exportPath');
		if (exportIndex !== -1) {
			const exportRoot = command.at(exportIndex + 1);
			if (!exportRoot) throw new Error('missing export path');
			await mkdir(exportRoot, { recursive: true });
			await writeFile(join(exportRoot, 'Release.ipa'), 'signed-ios-ipa');
		}

		return 0;
	};

	return { commands, config, projectRoot, run };
};

describe('iOS production releases', () => {
	test('archives and exports a signed immutable IPA with automatic build identity', async () => {
		const { commands, config, projectRoot, run } = await fixture();
		const identities: string[] = [];
		const release = await buildAbsoluteIosRelease({
			config,
			developmentTeam: 'abcde12345',
			host: 'macos',
			projectRoot,
			run,
			capture: () => ({ exitCode: 0, stderr: '', stdout: '' }),
			prepareBuildNumber: async (identity) => {
				identities.push(identity);

				return 8;
			}
		});
		expect(identities[0]).toMatch(/^[a-f0-9]{64}$/u);
		expect(commands[0]).toContain('MARKETING_VERSION=1.4.0');
		expect(commands[0]).toContain('CURRENT_PROJECT_VERSION=8');
		expect(commands[0]).toContain('DEVELOPMENT_TEAM=ABCDE12345');
		expect(commands[1]).toContain('-exportArchive');
		expect(release.metadata).toMatchObject({
			appId: 'com.example.release',
			artifact: 'App.ipa',
			buildNumber: 8,
			marketingVersion: '1.4.0',
			platform: 'ios',
			signed: true,
			type: 'ipa'
		});
		expect(release.metadata.releaseId).toBe(
			`amobile_ios_${release.metadata.sha256}`
		);
		expect(await readFile(release.artifactPath, 'utf8')).toBe(
			'signed-ios-ipa'
		);
	});

	test('requires macOS, a marketing version, and signing by default', async () => {
		const { config, projectRoot, run } = await fixture();
		await expect(
			buildAbsoluteIosRelease({
				config,
				developmentTeam: 'unsafe-team',
				host: 'macos',
				projectRoot,
				run
			})
		).rejects.toThrow('development team');
		await expect(
			buildAbsoluteIosRelease({ config, host: 'linux', projectRoot, run })
		).rejects.toThrow('require macOS');
		await expect(
			buildAbsoluteIosRelease({
				config,
				host: 'macos',
				projectRoot,
				run,
				capture: () => ({ exitCode: 1, stderr: '', stdout: '' })
			})
		).rejects.toThrow('unsigned iOS archive');
	});

	test('discovers Expo CNG workspaces and schemes without Capacitor paths', async () => {
		const {
			config: capacitor,
			projectRoot,
			run,
			commands
		} = await fixture();
		const config: NormalizedAbsoluteMobileConfig = {
			...capacitor,
			engine: 'expo'
		};
		const iosRoot = join(config.nativeProjectDirectory, 'ios');
		await rm(join(iosRoot, 'App'), { force: true, recursive: true });
		await mkdir(join(iosRoot, 'ExpoRelease.xcworkspace'), {
			recursive: true
		});
		await mkdir(
			join(iosRoot, 'ExpoRelease.xcodeproj', 'xcshareddata', 'xcschemes'),
			{ recursive: true }
		);
		await writeFile(
			join(
				iosRoot,
				'ExpoRelease.xcodeproj',
				'xcshareddata',
				'xcschemes',
				'ExpoRelease.xcscheme'
			),
			'<Scheme />\n'
		);
		const release = await buildAbsoluteIosRelease({
			allowUnsigned: true,
			config,
			host: 'macos',
			projectRoot,
			run,
			capture: () => ({ exitCode: 0, stderr: '', stdout: '' })
		});

		expect(commands[0]).toContain(join(iosRoot, 'ExpoRelease.xcworkspace'));
		expect(commands[0]).toContain('ExpoRelease');
		expect(release.metadata.engine).toBe('expo');
	});

	test('rejects ambiguous or out-of-project Xcode selection', async () => {
		const { config } = await fixture();
		const iosRoot = join(config.nativeProjectDirectory, 'ios');
		await mkdir(join(iosRoot, 'Other.xcworkspace'), { recursive: true });

		await expect(resolveAbsoluteIosXcodeProject(iosRoot)).rejects.toThrow(
			'multiple Xcode workspaces'
		);
		await expect(
			resolveAbsoluteIosXcodeProject(iosRoot, {
				workspacePath: '../../outside.xcworkspace'
			})
		).rejects.toThrow('must remain inside');
	});

	test('verifies remotely produced IPAs before immutable import', async () => {
		const root = await temporaryRootForImport();
		const artifactPath = join(root, 'remote.ipa');
		const contents = 'remote-signed-ios-ipa';
		await writeFile(artifactPath, contents);
		const sha256 = createHash('sha256').update(contents).digest('hex');
		const metadata = requireAbsoluteIosReleaseMetadata({
			appBuild: 'ambuild_remote',
			appId: 'com.example.remote',
			artifact: 'App.ipa',
			buildNumber: 19,
			bytes: Buffer.byteLength(contents),
			engine: 'expo',
			format: 1,
			marketingVersion: '2.0.0',
			platform: 'ios',
			releaseId: `amobile_ios_${sha256}`,
			runtime: '1',
			sha256,
			signed: true,
			type: 'ipa'
		});
		const release = await installAbsoluteIosRelease({
			artifactPath,
			metadata,
			projectRoot: root
		});
		expect(await readFile(release.artifactPath, 'utf8')).toBe(contents);
		await writeFile(artifactPath, 'substituted');
		await expect(
			installAbsoluteIosRelease({
				artifactPath,
				metadata,
				projectRoot: root
			})
		).rejects.toThrow('does not match');
	});
});

const temporaryRootForImport = async () => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-ios-import-'));
	roots.push(root);

	return root;
};
