import { afterEach, describe, expect, test } from 'bun:test';
import { createHash, generateKeyPairSync } from 'node:crypto';
import {
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
	normalizeAbsoluteMobileConfig,
	type NormalizedAbsoluteMobileConfig
} from '../../../src/mobile/config';
import {
	syncAbsoluteExpoWebAssets,
	writeAbsoluteExpoProject
} from '../../../src/mobile/expoProject';
import {
	createAbsoluteMobileComplianceReport,
	inspectAbsoluteMobileRelease
} from '../../../src/mobile/releaseDoctor';
import { applyAbsoluteNativeUpdates } from '../../../src/mobile/nativeUpdates';

const temporaryDirectories: string[] = [];
const CAPACITOR_VERSION = '8.5.0';
const ANDROID_FINGERPRINT =
	'AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA';

const releaseIndex = (origin: string) => `<!doctype html>
<meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob: https:; base-uri 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ${origin} wss://api.example.com; form-action 'none'">
<main>Release</main>`;

const writeReleaseBundle = async (
	root: string,
	config: ReturnType<typeof normalizeAbsoluteMobileConfig>
) => {
	const page = 'export const releaseFixture = true;\n';
	const bundleHash = createHash('sha256').update(page).digest('hex');
	await mkdir(join(root, 'pages'), { recursive: true });
	await Promise.all([
		writeFile(
			join(root, 'index.html'),
			releaseIndex(config.productionOrigin)
		),
		writeFile(join(root, 'absolute-mobile-bootstrap.js'), 'export {};\n'),
		writeFile(join(root, 'pages', `${bundleHash}.js`), page),
		writeFile(
			join(root, 'absolute-mobile-manifest.json'),
			`${JSON.stringify({
				appBuild: 'ambuild_release_fixture',
				appId: config.appId,
				appName: config.appName,
				deepLinkHosts: config.deepLinkHosts,
				deepLinkScheme: config.deepLinkScheme,
				deviceCapabilities: ['keyboard', 'systemBars'],
				entry: '/',
				format: 1,
				nativeRuntime: 'a'.repeat(64),
				pages: [
					{
						bundleHash,
						bundlePath: '/react/release.js',
						contract: 'contract-release',
						framework: 'react',
						localBundlePath: `./pages/${bundleHash}.js`,
						pageId: 'release',
						propsSchemaHash: 'props-release'
					}
				],
				productionOrigin: config.productionOrigin,
				routes: [{ method: 'GET', pageId: 'release', pattern: '/' }],
				runtime: '1',
				...(config.updates ? { updates: config.updates } : {})
			})}\n`
		)
	]);
};

const installPackageManifest = async (
	projectRoot: string,
	name: string,
	version: string
) => {
	const path = join(projectRoot, 'node_modules', name, 'package.json');
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify({ name, version })}\n`);
};

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});

const fixture = async () => {
	const projectRoot = await mkdtemp(
		join(tmpdir(), 'absolute-release-doctor-')
	);
	temporaryDirectories.push(projectRoot);
	const config = normalizeAbsoluteMobileConfig(
		{
			appId: 'com.example.release',
			appName: 'Release',
			deepLinks: {
				android: {
					sha256CertificateFingerprints: [ANDROID_FINGERPRINT]
				}
			},
			platforms: ['android'],
			server: { productionOrigin: 'https://api.example.com' }
		},
		projectRoot
	);
	const main = join(
		config.nativeProjectDirectory,
		'android',
		'app',
		'src',
		'main'
	);
	const assets = join(main, 'assets');
	await mkdir(join(assets, 'public'), { recursive: true });
	await writeFile(
		join(assets, 'capacitor.config.json'),
		`${JSON.stringify({ appId: config.appId, appName: config.appName })}\n`
	);
	await writeFile(
		join(main, 'AndroidManifest.xml'),
		`<manifest><application><activity android:name=".MainActivity" android:exported="true"><intent-filter android:autoVerify="true"><action android:name="android.intent.action.VIEW"/><category android:name="android.intent.category.DEFAULT"/><category android:name="android.intent.category.BROWSABLE"/><data android:scheme="https" android:host="api.example.com"/></intent-filter><intent-filter><data android:scheme="com.example.release"/></intent-filter></activity></application></manifest>\n`
	);
	await writeReleaseBundle(join(assets, 'public'), config);
	const providerManifest = join(
		projectRoot,
		'node_modules/@absolutejs/devices-capacitor/package.json'
	);
	await mkdir(dirname(providerManifest), { recursive: true });
	await writeFile(
		providerManifest,
		await readFile(
			join(
				import.meta.dir,
				'../../../node_modules/@absolutejs/devices-capacitor/package.json'
			),
			'utf8'
		)
	);
	const dependencies: Record<string, string> = {
		'@capacitor/android': CAPACITOR_VERSION,
		'@capacitor/cli': CAPACITOR_VERSION,
		'@capacitor/core': CAPACITOR_VERSION,
		'@capacitor/ios': CAPACITOR_VERSION,
		'@capacitor/keyboard': '8.0.5'
	};
	await writeFile(
		join(projectRoot, 'package.json'),
		JSON.stringify({ dependencies, name: 'release-fixture' })
	);
	await writeFile(join(projectRoot, 'bun.lock'), '');
	await Promise.all(
		Object.entries(dependencies).map(([name, version]) =>
			installPackageManifest(projectRoot, name, version)
		)
	);

	return { assets, config, main, projectRoot };
};

const expoFixture = async () => {
	const projectRoot = await mkdtemp(
		join(tmpdir(), 'absolute-expo-release-doctor-')
	);
	temporaryDirectories.push(projectRoot);
	const config = normalizeAbsoluteMobileConfig(
		{
			appId: 'com.example.expo.release',
			appName: 'Expo Release',
			deepLinks: {
				android: {
					sha256CertificateFingerprints: [ANDROID_FINGERPRINT]
				}
			},
			engine: 'expo',
			platforms: ['android'],
			server: { productionOrigin: 'https://api.example.com' }
		},
		projectRoot
	);
	await writeFile(
		join(projectRoot, 'package.json'),
		JSON.stringify({ name: 'expo-release-fixture' })
	);
	await writeFile(join(projectRoot, 'bun.lock'), '');
	const providerManifest = join(
		projectRoot,
		'node_modules/@absolutejs/devices-expo/package.json'
	);
	await mkdir(dirname(providerManifest), { recursive: true });
	await writeFile(
		providerManifest,
		await readFile(
			join(
				import.meta.dir,
				'../../../node_modules/@absolutejs/devices-expo/package.json'
			),
			'utf8'
		)
	);
	await writeReleaseBundle(config.bundleDirectory, config);
	await writeAbsoluteExpoProject(config, { projectRoot });
	const generatedManifest = JSON.parse(
		await readFile(
			join(config.nativeProjectDirectory, 'package.json'),
			'utf8'
		)
	) as {
		dependencies: Record<string, string>;
		devDependencies: Record<string, string>;
	};
	await writeFile(join(config.nativeProjectDirectory, 'bun.lock'), '');
	await Promise.all(
		Object.entries({
			...generatedManifest.dependencies,
			...generatedManifest.devDependencies
		}).map(([name, declared]) =>
			installPackageManifest(
				config.nativeProjectDirectory,
				name,
				declared.startsWith('~') ? declared.slice(1) : declared
			)
		)
	);
	await syncAbsoluteExpoWebAssets(config);
	const main = join(
		config.nativeProjectDirectory,
		'android',
		'app',
		'src',
		'main'
	);
	await mkdir(main, { recursive: true });
	await writeFile(
		join(main, 'AndroidManifest.xml'),
		`<manifest><application><activity android:name=".MainActivity" android:exported="true"><intent-filter android:autoVerify="true"><action android:name="android.intent.action.VIEW"/><category android:name="android.intent.category.DEFAULT"/><category android:name="android.intent.category.BROWSABLE"/><data android:host="api.example.com" android:scheme="https"/></intent-filter><intent-filter><data android:scheme="com.example.expo.release"/></intent-filter></activity></application></manifest>\n`
	);

	return { config, main, projectRoot };
};

describe('mobile release doctor', () => {
	test('passes a production-safe Expo Android projection', async () => {
		const { config, projectRoot } = await expoFixture();
		const result = await inspectAbsoluteMobileRelease(config, projectRoot);

		expect(result.ready).toBe(true);
		expect(
			result.checks.find(({ id }) => id === 'mobile.expo-versions')
		).toMatchObject({ status: 'pass' });
		expect(
			result.checks.find(({ id }) => id === 'expo.bundle-projection')
		).toMatchObject({ status: 'pass' });
	});

	test('passes a production-safe Expo iOS CNG projection', async () => {
		const expo = await expoFixture();
		const config: NormalizedAbsoluteMobileConfig = {
			...expo.config,
			appleAppIdPrefix: 'ABCDE12345',
			iosVersion: '1.2.0',
			platforms: ['ios']
		};
		await writeAbsoluteExpoProject(config, {
			projectRoot: expo.projectRoot
		});
		const iosRoot = join(config.nativeProjectDirectory, 'ios');
		const appRoot = join(iosRoot, 'ExpoRelease');
		await mkdir(join(iosRoot, 'ExpoRelease.xcodeproj'), {
			recursive: true
		});
		await mkdir(appRoot, { recursive: true });
		await Promise.all([
			writeFile(
				join(appRoot, 'Info.plist'),
				`<plist><dict><key>CFBundleURLTypes</key><array><dict><key>CFBundleURLSchemes</key><array><string>${config.deepLinkScheme}</string></array></dict></array></dict></plist>\n`
			),
			writeFile(
				join(appRoot, 'ExpoRelease.entitlements'),
				`<plist><dict><key>com.apple.developer.associated-domains</key><array><string>applinks:api.example.com</string></array></dict></plist>\n`
			),
			writeFile(
				join(iosRoot, 'ExpoRelease.xcodeproj', 'project.pbxproj'),
				'CODE_SIGN_ENTITLEMENTS = ExpoRelease/ExpoRelease.entitlements;\n'
			),
			writeFile(
				join(appRoot, 'AppDelegate.swift'),
				'final class AppDelegate {}\n'
			)
		]);

		const result = await inspectAbsoluteMobileRelease(
			config,
			expo.projectRoot
		);

		expect(result.ready).toBe(true);
		expect(
			result.checks.find(({ id }) => id === 'ios.expo-native-projection')
		).toMatchObject({ status: 'pass' });
		expect(result.checks.some(({ id }) => id === 'expo.ios-release')).toBe(
			false
		);
	});

	test('rejects a modified Expo embedded asset', async () => {
		const { config, projectRoot } = await expoFixture();
		const assetDirectory = join(
			config.nativeProjectDirectory,
			'assets',
			'absolute'
		);
		const [asset] = await readdir(assetDirectory);
		if (!asset) throw new Error('Expo release fixture asset is missing.');
		await writeFile(join(assetDirectory, asset), 'tampered\n');

		const result = await inspectAbsoluteMobileRelease(config, projectRoot);
		expect(
			result.checks.find(({ id }) => id === 'expo.bundle-projection')
		).toMatchObject({ status: 'fail' });
	});

	test('rejects Expo Android release manifests containing development trust', async () => {
		const { config, main, projectRoot } = await expoFixture();
		const manifestPath = join(main, 'AndroidManifest.xml');
		const manifest = await readFile(manifestPath, 'utf8');
		await writeFile(
			manifestPath,
			manifest.replace(
				'<application>',
				'<application android:networkSecurityConfig="@xml/absolutejs_dev_network_security">'
			)
		);

		const result = await inspectAbsoluteMobileRelease(config, projectRoot);
		expect(
			result.checks.find(({ id }) => id === 'android.cleartext')
		).toMatchObject({ status: 'fail' });
	});

	test('passes a production-safe Android projection', async () => {
		const { config, projectRoot } = await fixture();
		const result = await inspectAbsoluteMobileRelease(config, projectRoot);
		expect(result.ready).toBe(true);
		expect(result.checks.length).toBeGreaterThan(10);
		expect(result.checks.every((check) => check.status === 'pass')).toBe(
			true
		);
	});

	test('verifies the generated Android update watchdog against release config', async () => {
		const release = await fixture();
		const { publicKey } = generateKeyPairSync('ec', {
			namedCurve: 'prime256v1'
		});
		const config = normalizeAbsoluteMobileConfig(
			{
				appId: release.config.appId,
				appName: release.config.appName,
				deepLinks: {
					android: {
						sha256CertificateFingerprints: [ANDROID_FINGERPRINT]
					}
				},
				platforms: ['android'],
				server: { productionOrigin: release.config.productionOrigin },
				updates: {
					bootTimeoutMs: 7000,
					publicKeys: {
						key: publicKey
							.export({ format: 'der', type: 'spki' })
							.toString('base64')
					}
				}
			},
			release.projectRoot
		);
		const activityPath = join(
			release.main,
			'java/com/example/release/MainActivity.java'
		);
		await mkdir(dirname(activityPath), { recursive: true });
		await writeFile(
			activityPath,
			'package com.example.release; import com.getcapacitor.BridgeActivity; public class MainActivity extends BridgeActivity {}\n'
		);
		await writeReleaseBundle(join(release.assets, 'public'), config);
		await applyAbsoluteNativeUpdates(config, ['android']);

		const result = await inspectAbsoluteMobileRelease(
			config,
			release.projectRoot
		);
		expect(
			result.checks.find(({ id }) => id === 'android.update-watchdog')
		).toMatchObject({ status: 'pass' });
	});

	test('rejects an unprovisioned native capability', async () => {
		const { config, projectRoot } = await fixture();
		await writeFile(
			join(projectRoot, 'page.ts'),
			`import { clipboard } from '@absolutejs/devices'; void clipboard.readText();`
		);
		const result = await inspectAbsoluteMobileRelease(config, projectRoot);
		expect(result.ready).toBe(false);
		expect(result.checks.at(-1)).toMatchObject({
			id: 'mobile.device-capabilities',
			status: 'fail'
		});
		expect(result.checks.at(-1)?.detail).toContain(
			'@capacitor/clipboard@8.0.1'
		);
	});

	test('rejects a packaged page whose bytes no longer match its signed hash', async () => {
		const { assets, config, projectRoot } = await fixture();
		const [page] = await readdir(join(assets, 'public', 'pages'));
		if (!page) throw new Error('Release fixture page is missing.');
		await writeFile(join(assets, 'public', 'pages', page), 'tampered\n');

		const result = await inspectAbsoluteMobileRelease(config, projectRoot);
		expect(
			result.checks.find(({ id }) => id === 'android.bundle-integrity')
		).toMatchObject({ status: 'fail' });
		expect(
			result.checks.find(({ id }) => id === 'android.bundle-integrity')
		)?.toHaveProperty(
			'detail',
			expect.stringContaining('SHA-256 integrity')
		);
	});

	test('rejects ranged or drifted Capacitor release dependencies', async () => {
		const { config, projectRoot } = await fixture();
		await writeFile(
			join(projectRoot, 'package.json'),
			JSON.stringify({
				dependencies: {
					'@capacitor/android': CAPACITOR_VERSION,
					'@capacitor/cli': CAPACITOR_VERSION,
					'@capacitor/core': '^8.5.0'
				},
				name: 'release-fixture'
			})
		);

		const result = await inspectAbsoluteMobileRelease(config, projectRoot);
		expect(
			result.checks.find(({ id }) => id === 'mobile.capacitor-versions')
		).toMatchObject({ status: 'fail' });
	});

	test('fails explicit Android debugging and warns about exported components', async () => {
		const { config, main, projectRoot } = await fixture();
		const manifestPath = join(main, 'AndroidManifest.xml');
		const manifest = await readFile(manifestPath, 'utf8');
		await writeFile(
			manifestPath,
			manifest.replace(
				'<application>',
				'<application android:debuggable="true"><receiver android:exported="true" android:name=".OpenReceiver"/>'
			)
		);

		const result = await inspectAbsoluteMobileRelease(config, projectRoot);
		expect(
			result.checks.find(({ id }) => id === 'android.native-debugging')
		).toMatchObject({ status: 'fail' });
		expect(
			result.checks.find(({ id }) => id === 'android.exported-components')
		).toMatchObject({ status: 'warn' });
	});

	test('emits a redacted CI compliance projection', async () => {
		const { config, projectRoot } = await fixture();
		const result = await inspectAbsoluteMobileRelease(config, projectRoot);
		const report = createAbsoluteMobileComplianceReport(config, result);
		const serialized = JSON.stringify(report);

		expect(report).toMatchObject({
			format: 1,
			ready: true,
			summary: { failed: 0, warnings: 0 }
		});
		expect(report.checks.length).toBe(result.checks.length);
		expect(serialized).not.toContain(projectRoot);
		expect(serialized).not.toContain(ANDROID_FINGERPRINT);
		expect(serialized).not.toContain('remediation');
		expect(serialized).not.toContain('path');
	});

	test('rejects a missing iOS privacy projection for a detected capability', async () => {
		const { config, projectRoot } = await fixture();
		config.platforms.push('ios');
		config.iosVersion = '1.0.0';
		config.appleAppIdPrefix = 'ABCDE12345';
		await writeFile(
			join(projectRoot, 'page.ts'),
			`import { documents } from '@absolutejs/devices'; void documents.pick();`
		);
		const plugins: Record<string, string> = {
			'@capacitor/file-viewer': '2.0.2',
			'@capacitor/filesystem': '8.1.3',
			'@capacitor/keyboard': '8.0.5',
			'@capacitor/share': '8.0.1'
		};
		const iosApp = join(config.nativeProjectDirectory, 'ios', 'App', 'App');
		await mkdir(iosApp, { recursive: true });
		await writeFile(
			join(iosApp, 'Info.plist'),
			'<plist><dict><key>UIViewControllerBasedStatusBarAppearance</key><true/></dict></plist>'
		);
		await Promise.all(
			Object.entries(plugins).map(([name, version]) =>
				installPackageManifest(projectRoot, name, version)
			)
		);
		await writeFile(
			join(projectRoot, 'package.json'),
			JSON.stringify({
				dependencies: {
					'@capacitor/android': CAPACITOR_VERSION,
					'@capacitor/cli': CAPACITOR_VERSION,
					'@capacitor/core': CAPACITOR_VERSION,
					'@capacitor/ios': CAPACITOR_VERSION,
					...plugins
				},
				name: 'release-fixture'
			})
		);

		const result = await inspectAbsoluteMobileRelease(config, projectRoot);
		const capability = result.checks.find(
			({ id }) => id === 'mobile.device-capabilities'
		);
		expect(capability).toMatchObject({ status: 'fail' });
		expect(capability?.detail).toContain('privacy manifest');
	});

	test('rejects leaked live reload, cleartext, HMR, and an active journal', async () => {
		const { assets, config, main, projectRoot } = await fixture();
		await writeFile(
			join(assets, 'capacitor.config.json'),
			`${JSON.stringify({ appId: config.appId, appName: config.appName, server: { allowNavigation: ['*'], cleartext: true, url: 'http://localhost:3029' } })}\n`
		);
		await writeFile(
			join(main, 'AndroidManifest.xml'),
			`<manifest><application android:usesCleartextTraffic="true"><activity android:name=".MainActivity" android:exported="true"><intent-filter android:autoVerify="true"><category android:name="android.intent.category.BROWSABLE"/><data android:scheme="https" android:host="api.example.com"/></intent-filter><intent-filter><data android:scheme="com.example.release"/></intent-filter></activity></application></manifest>\n`
		);
		await writeFile(
			join(assets, 'public', 'index.html'),
			'<script>window.__HMR_WS__ = new WebSocket("/hmr")</script>'
		);
		const journal = join(
			projectRoot,
			'.absolutejs',
			'mobile',
			'dev-session'
		);
		await mkdir(journal, { recursive: true });
		await writeFile(join(journal, 'journal.json'), '{}');

		const result = await inspectAbsoluteMobileRelease(config, projectRoot);
		expect(result.ready).toBe(false);
		expect(
			result.checks
				.filter((check) => check.status === 'fail')
				.map((check) => check.id)
		).toEqual(
			expect.arrayContaining([
				'android.dev-journal',
				'android.capacitor-config',
				'android.cleartext',
				'android.hmr-assets',
				'android.content-security-policy'
			])
		);
	});

	test('rejects an invalid generated offline schema plan', async () => {
		const { config, projectRoot } = await fixture();
		await writeFile(
			join(projectRoot, 'package.json'),
			`${JSON.stringify({
				absolutejs: {
					sync: {
						localSchema: {
							migrations: [{ operations: [], toVersion: 3 }],
							version: 3
						}
					}
				},
				dependencies: { '@absolutejs/sync': '2.29.0' },
				name: 'release-fixture'
			})}\n`
		);
		const result = await inspectAbsoluteMobileRelease(config, projectRoot);
		expect(result.ready).toBe(false);
		expect(
			result.checks.find((check) => check.id === 'sync.storage-schema')
		).toMatchObject({
			id: 'sync.storage-schema',
			status: 'fail'
		});
	});

	test('reports the effective local data protection policy', async () => {
		const { config, projectRoot } = await fixture();
		await writeFile(
			join(projectRoot, 'package.json'),
			`${JSON.stringify({
				absolutejs: {
					sync: {
						localSchema: {
							localData: {
								collections: [
									{
										match: 'account:*',
										onProtectionUnavailable: 'memory-only',
										protection: 'required',
										sensitivity: 'private'
									}
								],
								maxBytesPerNamespace: 65_536,
								mutations: [
									{
										conflict: {
											maxAttempts: 1,
											strategy: 'client-wins'
										},
										match: 'account:*',
										onProtectionUnavailable: 'memory-only',
										protection: 'required',
										sensitivity: 'private'
									}
								]
							},
							version: 1
						}
					}
				},
				dependencies: { '@absolutejs/sync': '2.29.0' },
				name: 'release-policy-fixture'
			})}\n`
		);

		const result = await inspectAbsoluteMobileRelease(config, projectRoot);
		const policy = result.checks.find(
			(check) => check.id === 'sync.storage-schema'
		);
		expect(policy).toMatchObject({ status: 'pass' });
		expect(policy?.detail).toContain('1 collection rule(s)');
		expect(policy?.detail).toContain('1 mutation rule(s)');
		expect(policy?.detail).toContain('2 encryption-required');
		expect(policy?.detail).toContain('2 memory-only fallback(s)');
		expect(policy?.detail).toContain(
			'conflicts 1 client-wins/0 server-wins/0 manual'
		);
		expect(policy?.detail).toContain('65536-byte effective quota');
	});

	test('validates iOS production transport and rejects leaked development settings', async () => {
		const { config, projectRoot } = await fixture();
		config.platforms.push('ios');
		config.iosVersion = '1.0.0';
		config.appleAppIdPrefix = 'ABCDE12345';
		const iosApp = join(config.nativeProjectDirectory, 'ios', 'App', 'App');
		await mkdir(join(iosApp, 'public'), { recursive: true });
		await writeFile(
			join(iosApp, 'capacitor.config.json'),
			`${JSON.stringify({ appId: config.appId, appName: config.appName })}\n`
		);
		await writeFile(
			join(iosApp, 'Info.plist'),
			'<plist><dict><key>UIViewControllerBasedStatusBarAppearance</key><true/><key>CFBundleURLTypes</key><array><dict><key>CFBundleURLSchemes</key><array><string>com.example.release</string></array></dict></array></dict></plist>'
		);
		await writeReleaseBundle(join(iosApp, 'public'), config);
		await writeFile(
			join(
				config.nativeProjectDirectory,
				'ios',
				'App',
				'AbsoluteJS.entitlements'
			),
			'<plist><dict><key>com.apple.developer.associated-domains</key><array><string>applinks:api.example.com</string></array></dict></plist>'
		);
		const projectPath = join(
			config.nativeProjectDirectory,
			'ios',
			'App',
			'App.xcodeproj',
			'project.pbxproj'
		);
		await mkdir(dirname(projectPath), { recursive: true });
		await writeFile(
			projectPath,
			'CODE_SIGN_ENTITLEMENTS = App/AbsoluteJS.entitlements;\n'
		);
		const safe = await inspectAbsoluteMobileRelease(config, projectRoot);
		expect(safe.ready).toBe(true);
		expect(
			safe.checks.filter(({ id }) => id.startsWith('ios.'))
		).toHaveLength(10);

		const iosJournal = join(
			projectRoot,
			'.absolutejs',
			'mobile',
			'ios-dev-session'
		);
		await mkdir(iosJournal, { recursive: true });
		await writeFile(join(iosJournal, 'journal.json'), '{}');

		await writeFile(
			join(iosApp, 'Info.plist'),
			'<plist><dict><key>NSAllowsArbitraryLoads</key><true/></dict></plist>'
		);
		await writeFile(
			join(iosApp, 'public', 'index.html'),
			'<script>window.__HMR_WS__ = true</script>'
		);
		const unsafe = await inspectAbsoluteMobileRelease(config, projectRoot);
		expect(unsafe.ready).toBe(false);
		expect(
			unsafe.checks
				.filter((check) => check.status === 'fail')
				.map((check) => check.id)
		).toContain('ios.transport-security');
		expect(
			unsafe.checks
				.filter((check) => check.status === 'fail')
				.map((check) => check.id)
		).toContain('ios.hmr-assets');
		expect(
			unsafe.checks
				.filter((check) => check.status === 'fail')
				.map((check) => check.id)
		).toContain('ios.dev-journal');
	});
});
