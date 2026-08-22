import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildAbsoluteAndroidRelease } from '../../../src/mobile/androidRelease';
import { normalizeAbsoluteMobileConfig } from '../../../src/mobile/config';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});

const fixture = async () => {
	const projectRoot = await mkdtemp(
		join(tmpdir(), 'absolute-android-release-')
	);
	temporaryDirectories.push(projectRoot);
	const config = normalizeAbsoluteMobileConfig(
		{
			appId: 'com.example.release',
			appName: 'Release',
			platforms: ['android'],
			server: { productionOrigin: 'https://api.example.com' }
		},
		projectRoot
	);
	await mkdir(config.bundleDirectory, { recursive: true });
	await writeFile(
		join(config.bundleDirectory, 'absolute-mobile-manifest.json'),
		`${JSON.stringify({ appBuild: 'ambuild_fixture', appId: config.appId, runtime: '1' })}\n`
	);
	const artifactPath = join(
		config.nativeProjectDirectory,
		'android',
		'app',
		'build',
		'outputs',
		'bundle',
		'release',
		'app-release.aab'
	);
	const run = async (command: string[]) => {
		expect(command).toContain('bundleRelease');
		await mkdir(dirname(artifactPath), { recursive: true });
		await writeFile(artifactPath, 'signed-app-bundle');

		return 0;
	};

	return { artifactPath, config, projectRoot, run };
};

describe('Android production releases', () => {
	test('builds a signed immutable AAB with deployment-friendly metadata', async () => {
		const { config, projectRoot, run } = await fixture();
		const capture = (command: string[]) => ({
			exitCode: 0,
			stderr: '',
			stdout: command.includes('-verify') ? 'jar verified.\n' : ''
		});
		const first = await buildAbsoluteAndroidRelease({
			androidRoot: '/sdk',
			capture,
			config,
			host: 'linux',
			jarsigner: '/jdk/bin/jarsigner',
			projectRoot,
			run
		});
		const second = await buildAbsoluteAndroidRelease({
			androidRoot: '/sdk',
			capture,
			config,
			host: 'linux',
			jarsigner: '/jdk/bin/jarsigner',
			projectRoot,
			run
		});

		expect(first.metadata).toMatchObject({
			appBuild: 'ambuild_fixture',
			appId: 'com.example.release',
			artifact: 'app-release.aab',
			engine: 'capacitor',
			format: 1,
			platform: 'android',
			runtime: '1',
			signed: true,
			type: 'aab'
		});
		expect(first.metadata.releaseId).toBe(
			`amobile_android_${first.metadata.sha256}`
		);
		expect(second).toEqual(first);
		expect(await readFile(first.artifactPath, 'utf8')).toBe(
			'signed-app-bundle'
		);
		await writeFile(first.artifactPath, 'tampered');
		await expect(
			buildAbsoluteAndroidRelease({
				androidRoot: '/sdk',
				capture,
				config,
				host: 'linux',
				jarsigner: '/jdk/bin/jarsigner',
				projectRoot,
				run
			})
		).rejects.toThrow('artifact is missing or modified');
	});

	test('rejects unsigned output by default and labels an explicit unsigned build', async () => {
		const { config, projectRoot, run } = await fixture();
		const capture = () => ({ exitCode: 1, stderr: '', stdout: '' });
		await expect(
			buildAbsoluteAndroidRelease({
				androidRoot: '/sdk',
				capture,
				config,
				host: 'linux',
				jarsigner: '/jdk/bin/jarsigner',
				projectRoot,
				run
			})
		).rejects.toThrow('unsigned App Bundle');

		const release = await buildAbsoluteAndroidRelease({
			allowUnsigned: true,
			androidRoot: '/sdk',
			capture,
			config,
			host: 'linux',
			jarsigner: '/jdk/bin/jarsigner',
			projectRoot,
			run
		});
		expect(release.metadata.signed).toBe(false);
	});

	test('keeps custom output inside the project', async () => {
		const { config, projectRoot, run } = await fixture();
		await expect(
			buildAbsoluteAndroidRelease({
				allowUnsigned: true,
				androidRoot: '/sdk',
				config,
				host: 'linux',
				jarsigner: null,
				outputDirectory: '../outside',
				projectRoot,
				run,
				capture: () => ({ exitCode: 1, stderr: '', stdout: '' })
			})
		).rejects.toThrow('must remain inside the project');
	});
});
