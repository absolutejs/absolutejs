import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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

const fixture = async (engine: 'capacitor' | 'expo' = 'capacitor') => {
	const projectRoot = await mkdtemp(
		join(tmpdir(), 'absolute-android-release-')
	);
	temporaryDirectories.push(projectRoot);
	const config = normalizeAbsoluteMobileConfig(
		{
			appId: 'com.example.release',
			appName: 'Release',
			engine,
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
	const nativeDirectory = join(config.nativeProjectDirectory, 'android');
	await mkdir(join(nativeDirectory, 'app'), { recursive: true });
	await writeFile(
		join(nativeDirectory, 'capacitor.settings.gradle'),
		"include ':capacitor-android'\nproject(':capacitor-android').projectDir = new File('../../node_modules/@capacitor/android/capacitor')\n"
	);
	const capacitorAndroid = join(
		config.nativeProjectDirectory,
		'..',
		'node_modules',
		'@capacitor',
		'android',
		'capacitor'
	);
	await mkdir(capacitorAndroid, { recursive: true });
	await writeFile(join(capacitorAndroid, 'build.gradle'), 'plugins {}\n');
	await writeFile(
		join(nativeDirectory, 'app', 'build.gradle'),
		'plugins {}\n'
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

	test('builds Expo output with the same immutable release contract and production environment', async () => {
		const { artifactPath, config, projectRoot } = await fixture('expo');
		let buildEnvironment: Record<string, string | undefined> | undefined;
		const release = await buildAbsoluteAndroidRelease({
			allowUnsigned: true,
			androidRoot: '/sdk',
			config,
			env: {
				BABEL_ENV: 'production',
				NODE_ENV: 'production'
			},
			host: 'linux',
			jarsigner: null,
			projectRoot,
			capture: () => ({ exitCode: 1, stderr: '', stdout: '' }),
			run: async (command, options) => {
				expect(command).toContain('bundleRelease');
				buildEnvironment = options?.env;
				await mkdir(dirname(artifactPath), { recursive: true });
				await writeFile(artifactPath, 'expo-app-bundle');

				return 0;
			}
		});

		expect(release.metadata).toMatchObject({
			appBuild: 'ambuild_fixture',
			engine: 'expo',
			platform: 'android',
			type: 'aab'
		});
		expect(buildEnvironment).toEqual({
			BABEL_ENV: 'production',
			NODE_ENV: 'production'
		});
	});

	test('fingerprints an Expo Android project for automatic version codes', async () => {
		const { artifactPath, config, projectRoot } = await fixture('expo');
		const identities: string[] = [];
		await buildAbsoluteAndroidRelease({
			allowUnsigned: true,
			androidRoot: '/sdk',
			config,
			host: 'linux',
			jarsigner: null,
			projectRoot,
			capture: () => ({ exitCode: 1, stderr: '', stdout: '' }),
			prepareVersionCode: async (identity) => {
				identities.push(identity);

				return 44;
			},
			run: async () => {
				await mkdir(dirname(artifactPath), { recursive: true });
				await writeFile(artifactPath, 'versioned-expo-app-bundle');

				return 0;
			}
		});

		expect(identities).toHaveLength(1);
		expect(identities[0]).toMatch(/^[a-f0-9]{64}$/u);
	});

	test('builds Expo production AABs in a Windows-local mirror from WSL', async () => {
		const { config, projectRoot } = await fixture('expo');
		const androidRoot = join(projectRoot, 'Windows SDK', 'Android', 'Sdk');
		const buildId = Bun.hash(resolve(config.nativeProjectDirectory))
			.toString(16)
			.slice(0, 10);
		const mirroredArtifact = join(
			resolve(androidRoot, '..', '..', 'ExpoBuilds', buildId),
			'android',
			'app',
			'build',
			'outputs',
			'bundle',
			'release',
			'app-release.aab'
		);
		const commands: string[][] = [];
		let buildEnvironment: Record<string, string | undefined> | undefined;
		const release = await buildAbsoluteAndroidRelease({
			allowUnsigned: true,
			androidRoot,
			config,
			env: {
				ABSOLUTE_ANDROID_KEY_PASSWORD: 'must-not-enter-script',
				BABEL_ENV: 'production',
				NODE_ENV: 'production'
			},
			host: 'wsl',
			jarsigner: null,
			projectRoot,
			versionCode: 52,
			capture: ([command, flag, path]) => ({
				exitCode: command === 'wslpath' && flag === '-w' ? 0 : 1,
				stderr: '',
				stdout:
					command === 'wslpath' && flag === '-w'
						? `C:\\AbsoluteJS\\${Buffer.from(path ?? '').toString('hex')}\n`
						: ''
			}),
			run: async (command, options) => {
				commands.push(command);
				buildEnvironment = options?.env;
				await mkdir(dirname(mirroredArtifact), { recursive: true });
				await writeFile(mirroredArtifact, 'wsl-expo-app-bundle');

				return 0;
			}
		});

		expect(release.metadata).toMatchObject({
			engine: 'expo',
			platform: 'android',
			type: 'aab',
			versionCode: 52
		});
		expect(await readFile(release.artifactPath, 'utf8')).toBe(
			'wsl-expo-app-bundle'
		);
		expect(commands).toHaveLength(1);
		expect(commands[0]?.slice(0, 3)).toEqual([
			'powershell.exe',
			'-NoProfile',
			'-EncodedCommand'
		]);
		const script = Buffer.from(
			commands[0]?.at(-1) ?? '',
			'base64'
		).toString('utf16le');
		expect(script).toContain('robocopy.exe $source $directory /MIR');
		expect(script).toContain('Get-Command bun.exe -ErrorAction Stop');
		expect(script).toContain('$mutex.WaitOne([TimeSpan]::FromMinutes(30))');
		expect(script).toContain('AbandonedMutexException');
		expect(script).toContain('$mutex.ReleaseMutex()');
		expect(script).toContain('& subst.exe $drive $mirrorRoot');
		expect(script).toContain('@gradleArguments bundleRelease');
		expect(script).toContain(
			Buffer.from(
				JSON.stringify(['-Pandroid.injected.version.code=52'])
			).toString('base64')
		);
		expect(script).not.toContain('reactNativeArchitectures');
		expect(script).not.toContain('adb.exe');
		expect(script).not.toContain('must-not-enter-script');
		expect(buildEnvironment).toEqual({
			ABSOLUTE_ANDROID_KEY_PASSWORD: 'must-not-enter-script',
			BABEL_ENV: 'production',
			NODE_ENV: 'production'
		});
	});

	test('fails closed when the Windows Expo production build fails', async () => {
		const { config, projectRoot } = await fixture('expo');
		await expect(
			buildAbsoluteAndroidRelease({
				allowUnsigned: true,
				androidRoot: join(projectRoot, 'Windows SDK', 'Android', 'Sdk'),
				config,
				host: 'wsl',
				jarsigner: null,
				projectRoot,
				capture: ([command, flag]) => ({
					exitCode: command === 'wslpath' && flag === '-w' ? 0 : 1,
					stderr: '',
					stdout: 'C:\\AbsoluteJS\\build\n'
				}),
				run: async () => 17
			})
		).rejects.toThrow(
			'Expo Android Windows release build exited with status 17'
		);
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

	test('signs CI output without putting passwords in command arguments', async () => {
		const { config, projectRoot, run } = await fixture();
		const commands: string[][] = [];
		let signed = false;
		const capture = (command: string[]) => {
			commands.push(command);
			if (command.includes('-verify'))
				return {
					exitCode: signed ? 0 : 1,
					stderr: '',
					stdout: signed ? 'jar verified.\n' : ''
				};
			signed = true;

			return { exitCode: 0, stderr: '', stdout: '' };
		};
		const release = await buildAbsoluteAndroidRelease({
			androidRoot: '/sdk',
			capture,
			config,
			host: 'linux',
			jarsigner: '/jdk/bin/jarsigner',
			projectRoot,
			run,
			signing: {
				keyAlias: 'upload',
				keyPasswordEnvironment: 'ABSOLUTE_ANDROID_KEY_PASSWORD',
				keystorePath: '/runner/absolute-release.jks',
				storePasswordEnvironment: 'ABSOLUTE_ANDROID_KEYSTORE_PASSWORD'
			}
		});
		const signCommand = commands.find(
			(command) => !command.includes('-verify')
		);

		expect(release.metadata.signed).toBe(true);
		expect(signCommand).toContain('-storepass:env');
		expect(signCommand).toContain('ABSOLUTE_ANDROID_KEYSTORE_PASSWORD');
		expect(signCommand).toContain('-keypass:env');
		expect(signCommand).toContain('ABSOLUTE_ANDROID_KEY_PASSWORD');
		expect(commands.flat().join(' ')).not.toContain('store-secret');
		expect(commands.flat().join(' ')).not.toContain('key-secret');
	});

	test('injects an automatically prepared Google Play version code into Gradle and metadata', async () => {
		const { artifactPath, config, projectRoot } = await fixture();
		const commands: string[][] = [];
		const buildIdentities: string[] = [];
		const release = await buildAbsoluteAndroidRelease({
			allowUnsigned: true,
			androidRoot: '/sdk',
			config,
			host: 'linux',
			jarsigner: null,
			projectRoot,
			capture: () => ({ exitCode: 1, stderr: '', stdout: '' }),
			prepareVersionCode: async (buildIdentity) => {
				buildIdentities.push(buildIdentity);

				return 43;
			},
			run: async (command) => {
				commands.push(command);
				await mkdir(dirname(artifactPath), { recursive: true });
				await writeFile(artifactPath, 'versioned-app-bundle');

				return 0;
			}
		});

		expect(buildIdentities).toHaveLength(1);
		expect(buildIdentities[0]).toMatch(/^[a-f0-9]{64}$/u);
		expect(commands[0]).toContain('-Pandroid.injected.version.code=43');
		expect(release.metadata.versionCode).toBe(43);
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
