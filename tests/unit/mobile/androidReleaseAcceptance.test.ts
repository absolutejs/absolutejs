import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	ABSOLUTE_BUNDLETOOL_VERSION,
	ensureAbsoluteBundletool,
	readAbsoluteAndroidRelease,
	runAbsoluteAndroidReleaseAcceptance,
	type AbsoluteAndroidRelease
} from '../../../src/mobile/androidReleaseAcceptance';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});

const temporary = async (name: string) => {
	const root = await mkdtemp(join(tmpdir(), name));
	temporaryDirectories.push(root);

	return root;
};

const releaseFixture = async () => {
	const root = await temporary('absolute-android-release-');
	const releaseRoot = join(root, 'releases', 'candidate');
	await mkdir(releaseRoot, { recursive: true });
	const artifact = new TextEncoder().encode('immutable-aab');
	const digest = createHash('sha256').update(artifact).digest('hex');
	await writeFile(join(releaseRoot, 'app-release.aab'), artifact);
	await writeFile(
		join(releaseRoot, 'release.json'),
		JSON.stringify({
			appBuild: 'build-1',
			appId: 'com.absolutejs.release',
			artifact: 'app-release.aab',
			bytes: artifact.byteLength,
			engine: 'expo',
			format: 1,
			platform: 'android',
			releaseId: `amobile_android_${digest}`,
			runtime: 'runtime-1',
			sha256: digest,
			signed: true,
			type: 'aab',
			versionCode: 12
		})
	);

	return { releaseRoot, root };
};

describe('Android installed release acceptance', () => {
	test('revalidates immutable release bytes and rejects path escape', async () => {
		const { releaseRoot, root } = await releaseFixture();
		const release = await readAbsoluteAndroidRelease(
			root,
			join('releases', 'candidate')
		);
		expect(release.metadata).toMatchObject({
			appId: 'com.absolutejs.release',
			engine: 'expo',
			versionCode: 12
		});
		await writeFile(join(releaseRoot, 'app-release.aab'), 'modified');
		await expect(
			readAbsoluteAndroidRelease(root, join('releases', 'candidate'))
		).rejects.toThrow('missing or modified');
		await expect(
			readAbsoluteAndroidRelease(root, '../release.json')
		).rejects.toThrow('must remain inside the project');
	});

	test('requires approval before provisioning pinned Bundletool', async () => {
		const root = await temporary('absolute-bundletool-');
		await expect(
			ensureAbsoluteBundletool({ approved: false, root })
		).rejects.toThrow(
			`Bundletool ${ABSOLUTE_BUNDLETOOL_VERSION} is required`
		);
	});

	test('installs the APK set and proves two offline embedded boots', async () => {
		const root = await temporary('absolute-release-acceptance-');
		const artifactPath = join(root, 'app-release.aab');
		await writeFile(artifactPath, 'aab');
		const release = {
			artifactPath,
			metadata: {
				appBuild: 'build-1',
				appId: 'com.absolutejs.release',
				artifact: 'app-release.aab',
				bytes: 3,
				engine: 'expo',
				format: 1,
				platform: 'android',
				releaseId: `amobile_android_${'a'.repeat(64)}`,
				runtime: 'runtime-1',
				sha256: 'a'.repeat(64),
				signed: true,
				type: 'aab',
				versionCode: 12
			},
			metadataPath: join(root, 'release.json'),
			releaseRoot: root
		} satisfies AbsoluteAndroidRelease;
		const commands: string[][] = [];
		const result = await runAbsoluteAndroidReleaseAcceptance({
			adb: '/sdk/adb',
			artifactDirectory: join(root, 'artifacts'),
			bundletool: '/tools/bundletool.jar',
			host: 'linux',
			java: '/jdk/java',
			release,
			serial: 'emulator-5554',
			stabilityMs: 1,
			run: async (command) => {
				commands.push(command);
				if (command.includes('build-apks')) {
					const output = command
						.find((part) => part.startsWith('--output='))
						?.slice('--output='.length);
					if (!output) throw new Error('Missing test APK output.');
					await writeFile(output, 'apks');
				}
				if (command.includes('dumpsys'))
					return {
						exitCode: 0,
						stderr: '',
						stdout: 'Package [com.absolutejs.release]\n versionCode=12 minSdk=24\n versionName=1.0\n'
					};
				if (command.includes('resolve-activity'))
					return {
						exitCode: 0,
						stderr: '',
						stdout: 'com.absolutejs.release/.MainActivity\n'
					};
				if (command.includes('pidof'))
					return { exitCode: 0, stderr: '', stdout: '123\n' };
				if (command.includes('logcat') && command.includes('-d'))
					return {
						exitCode: 0,
						stderr: '',
						stdout: 'I/AbsoluteJS: Expo embedded web content ready\n'
					};
				if (command.includes('settings'))
					return { exitCode: 0, stderr: '', stdout: '1\n' };

				return { exitCode: 0, stderr: '', stdout: 'Success\n' };
			}
		});

		expect(result).toMatchObject({
			embeddedOffline: true,
			engine: 'expo',
			installed: { versionCode: 12 },
			status: 'pass'
		});
		expect(
			commands.filter(
				(command) => command.includes('am') && command.includes('start')
			)
		).toHaveLength(2);
		expect(
			commands.some((command) => command.includes('install-apks'))
		).toBe(true);
		expect(
			commands.some(
				(command) =>
					command.includes('wifi') && command.includes('disable')
			)
		).toBe(true);
		expect(
			commands.some(
				(command) =>
					command.includes('wifi') && command.includes('enable')
			)
		).toBe(true);
	});
});
