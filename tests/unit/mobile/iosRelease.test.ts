import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAbsoluteIosRelease } from '../../../src/mobile/iosRelease';
import { normalizeAbsoluteMobileConfig } from '../../../src/mobile/config';

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
});
