import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { normalizeAbsoluteMobileConfig } from '../../../src/mobile/config';
import {
	syncAbsoluteExpoWebAssets,
	writeAbsoluteExpoProject
} from '../../../src/mobile/expoProject';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});

const fixture = async (auth = false, sync = false, updates = false) => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-expo-project-'));
	temporaryDirectories.push(root);
	await mkdir(join(root, 'mobile', 'native'), { recursive: true });
	await writeFile(
		join(root, 'mobile', 'native', 'scanner.tsx'),
		'export default function Scanner() { return null; }\n'
	);
	await writeFile(
		join(root, 'package.json'),
		JSON.stringify({
			dependencies: {
				...(auth ? { '@absolutejs/auth': '0.75.6' } : {}),
				...(sync ? { '@absolutejs/sync': '2.31.0' } : {})
			}
		})
	);
	const config = normalizeAbsoluteMobileConfig(
		{
			appId: 'com.example.product',
			appName: 'Product',
			deepLinks: { hosts: ['app.example.com'], scheme: 'product' },
			engine: 'expo',
			routes: {
				native: {
					'/files/*': 'mobile/native/scanner.tsx',
					'/products/:productId': 'mobile/native/scanner.tsx',
					'/scanner': 'mobile/native/scanner.tsx'
				}
			},
			server: { productionOrigin: 'https://api.example.com' },
			...(updates
				? {
						updates: {
							publicKeys: {
								main: generateKeyPairSync('ec', {
									namedCurve: 'prime256v1'
								})
									.publicKey.export({
										format: 'der',
										type: 'spki'
									})
									.toString('base64')
							}
						}
					}
				: {})
		},
		root
	);

	return { config, root };
};

describe('experimental Expo project', () => {
	test('generates a CNG shell with explicit native ownership and web catch-all', async () => {
		const { config, root } = await fixture();
		const first = await writeAbsoluteExpoProject(config, {
			projectRoot: root
		});
		const second = await writeAbsoluteExpoProject(config, {
			projectRoot: root
		});
		const project = config.nativeProjectDirectory;
		const [
			appConfig,
			dynamicConfig,
			nativeRoute,
			packageSource,
			plugin,
			nativeRouteRuntime,
			webAssets,
			webHost
		] = await Promise.all([
			readFile(join(project, 'app.json'), 'utf8'),
			readFile(join(project, 'app.config.js'), 'utf8'),
			readFile(join(project, 'app', 'scanner', 'index.tsx'), 'utf8'),
			readFile(join(project, 'package.json'), 'utf8'),
			readFile(
				join(project, 'plugins', 'withAbsoluteDevelopmentCa.js'),
				'utf8'
			),
			readFile(
				join(project, 'src', 'generated', 'AbsoluteNativeRoute.tsx'),
				'utf8'
			),
			readFile(join(project, 'src', 'generated', 'webAssets.ts'), 'utf8'),
			readFile(
				join(project, 'src', 'generated', 'AbsoluteWebHost.tsx'),
				'utf8'
			)
		]);

		expect(first.changed).toBeGreaterThan(0);
		expect(second.changed).toBe(0);
		expect(appConfig).toContain('applinks:app.example.com');
		expect(dynamicConfig).toContain('ABSOLUTE_EXPO_DEVELOPMENT_CA_PATH');
		expect(plugin).toContain('<debug-overrides>');
		expect(plugin).toContain('android:networkSecurityConfig');
		expect(appConfig).toContain('"scheme": "product"');
		expect(nativeRoute).toContain('mobile/native/scanner');
		expect(nativeRoute).toContain('createAbsoluteNativeRoute');
		expect(nativeRouteRuntime).toContain(
			'application/vnd.absolute.native-route+json'
		);
		expect(nativeRouteRuntime).toContain('x-absolute-mobile-app-build');
		expect(nativeRouteRuntime).toContain('ABSOLUTE_MOBILE_MANIFEST');
		expect(nativeRouteRuntime).toContain('new AbortController()');
		expect(nativeRouteRuntime).toContain('controller.signal');
		expect(nativeRouteRuntime).toContain('return () => controller.abort()');
		expect(nativeRouteRuntime).toContain('if (!controller.signal.aborted)');
		expect(nativeRouteRuntime).not.toContain('absoluteExpoAuth');
		expect(packageSource).toContain('expo-dev-client');
		expect(webAssets).toContain('absolute prepare');
		expect(webHost).toContain('createExpoDevicesBridgeHost');
		expect(webHost).toContain('useSafeAreaInsets');
		expect(webHost).toContain('absolute:native-host-metrics');
		expect(webHost).toContain("new CustomEvent('absolute:back-request'");
		expect(webHost).toContain('globalThis.__absoluteRequestBack?.()');
		expect(webHost).toContain("message.event === 'back-unhandled'");
		expect(webHost).toContain('bridgeBootstrap(pathname, safeAreaInsets)');
		expect(webHost).toContain("message.method.startsWith('devices.')");
		expect(webHost).toContain('EXPO_PUBLIC_ABSOLUTE_DEV_ANDROID_ORIGIN');
		expect(webHost).toContain("'expo-android'");
		expect(webHost).toContain('["__absolute","native"]');
		expect(webHost).toContain('NATIVE_ROUTE_PATTERNS');
		expect(webHost).toContain("expected === '*'");
		expect(
			await readFile(join(project, 'app', '[...absolute].tsx'), 'utf8')
		).toContain('AbsoluteWebHost');
		expect(
			await readFile(
				join(project, 'app', 'products', '[productId]', 'index.tsx'),
				'utf8'
			)
		).toContain('mobile/native/scanner');
		expect(
			await readFile(
				join(
					project,
					'app',
					'files',
					'[...absoluteWildcard]',
					'index.tsx'
				),
				'utf8'
			)
		).toContain('mobile/native/scanner');
	});

	test('prunes only stale AbsoluteJS-managed native route wrappers', async () => {
		const { config, root } = await fixture();
		await writeAbsoluteExpoProject(config, { projectRoot: root });
		const project = config.nativeProjectDirectory;
		const stale = join(project, 'app', 'scanner', 'index.tsx');
		const applicationOwned = join(project, 'app', 'application-owned.tsx');
		await writeFile(
			applicationOwned,
			'export default function Owned() { return null; }\n'
		);
		delete config.expoNativeRoutes['/scanner'];

		const result = await writeAbsoluteExpoProject(config, {
			projectRoot: root
		});

		expect(result.changed).toBe(2);
		await expect(readFile(stale, 'utf8')).rejects.toThrow();
		expect(await readFile(applicationOwned, 'utf8')).toContain('Owned');
	});

	test('materializes a Metro-safe opaque asset map preserving web paths', async () => {
		const { config, root } = await fixture();
		await writeAbsoluteExpoProject(config, { projectRoot: root });
		await mkdir(join(config.bundleDirectory, 'pages'), { recursive: true });
		await Promise.all([
			writeFile(
				join(config.bundleDirectory, 'index.html'),
				'<main></main>'
			),
			writeFile(
				join(config.bundleDirectory, 'absolute-mobile-manifest.json'),
				JSON.stringify({
					appBuild: 'ambuild_test',
					internalSigningMaterial: 'must-not-be-embedded',
					pages: [
						{
							bundleHash: 'bundle-product',
							contract: 'react:Product:schema-product',
							pageId: 'Product'
						}
					],
					productionOrigin: 'https://api.example.com',
					routes: [
						{
							method: 'GET',
							pageId: 'Product',
							pattern: '/products/:productId'
						},
						{
							method: 'POST',
							pattern: '/products'
						}
					],
					runtime: '1'
				})
			),
			writeFile(
				join(config.bundleDirectory, 'pages', 'app.js'),
				'export {};'
			)
		]);

		const result = await syncAbsoluteExpoWebAssets(config);
		const source = await readFile(
			join(
				config.nativeProjectDirectory,
				'src',
				'generated',
				'webAssets.ts'
			),
			'utf8'
		);

		expect(result).toMatchObject({ appBuild: 'ambuild_test', assets: 3 });
		expect(source).toContain('pages/app.js');
		expect(source).toContain('.absasset');
		expect(source).toContain("new File(root, 'index.html').uri");
		expect(source).toContain('ABSOLUTE_MOBILE_MANIFEST');
		expect(source).toContain('react:Product:schema-product');
		expect(source).not.toContain('"method":"POST"');
		expect(source).not.toContain('must-not-be-embedded');
	});

	test('provisions detected provider-neutral device capabilities and Expo plugins', async () => {
		const { config, root } = await fixture();
		await writeFile(
			join(root, 'device-page.ts'),
			`import { camera, clipboard, documents, location, share } from '@absolutejs/devices'; void camera; void clipboard; void documents; void location; void share;`
		);
		await writeAbsoluteExpoProject(config, { projectRoot: root });
		const project = config.nativeProjectDirectory;
		const [app, manifest, devices] = await Promise.all([
			readFile(join(project, 'app.json'), 'utf8'),
			readFile(join(project, 'package.json'), 'utf8'),
			readFile(
				join(project, 'src', 'generated', 'AbsoluteDevices.ts'),
				'utf8'
			)
		]);
		expect(app).toContain('expo-image-picker');
		expect(app).toContain('expo-document-picker');
		expect(app).toContain('expo-location');
		expect(manifest).toContain('"@absolutejs/devices-expo": "0.0.2"');
		expect(manifest).toContain('"expo-image-manipulator": "57.0.14"');
		expect(devices).toContain('createExpoCameraCapability');
		expect(devices).toContain('createExpoClipboardCapability');
		expect(devices).toContain('createExpoDocumentsCapability');
		expect(devices).toContain('createExpoLocationCapability');
		expect(devices).toContain('createExpoShareCapability');
		expect(devices).toContain('installDeviceAdapter(absoluteExpoDevices)');
	});

	test('automatically provisions native-owned Expo Auth and secure HTTP', async () => {
		const { config, root } = await fixture(true);
		await writeAbsoluteExpoProject(config, { projectRoot: root });
		const project = config.nativeProjectDirectory;
		const [
			appConfig,
			authSource,
			layout,
			nativeRouteRuntime,
			packageSource,
			tsconfig,
			webHost
		] = await Promise.all([
			readFile(join(project, 'app.json'), 'utf8'),
			readFile(
				join(project, 'src', 'generated', 'AbsoluteAuth.ts'),
				'utf8'
			),
			readFile(join(project, 'app', '_layout.tsx'), 'utf8'),
			readFile(
				join(project, 'src', 'generated', 'AbsoluteNativeRoute.tsx'),
				'utf8'
			),
			readFile(join(project, 'package.json'), 'utf8'),
			readFile(join(project, 'tsconfig.json'), 'utf8'),
			readFile(
				join(project, 'src', 'generated', 'AbsoluteWebHost.tsx'),
				'utf8'
			)
		]);

		expect(packageSource).toContain('@absolutejs/auth-expo');
		expect(packageSource).toContain('expo-secure-store');
		expect(packageSource).toContain('expo-web-browser');
		expect(appConfig).toContain('expo-secure-store');
		expect(authSource).toContain('absolutejs-native:com.example.product');
		expect(authSource).toContain('product://auth/callback');
		expect(authSource).toContain('installAuthClientRuntimeTransport');
		expect(authSource).not.toContain('refreshToken');
		expect(layout).toContain('startAbsoluteExpoAuth');
		expect(nativeRouteRuntime).toContain('absoluteExpoAuth.fetchOptional');
		expect(nativeRouteRuntime).not.toContain("headers.set('authorization'");
		expect(tsconfig).toContain('@absolutejs/auth/*');
		expect(webHost).toContain('absoluteExpoAuth.fetchOptional');
		expect(webHost).toContain("message.method === 'auth.signIn'");
		expect(webHost).not.toContain('authorization:');
		await expect(
			new Bun.Transpiler({ loader: 'tsx' }).transform(webHost)
		).resolves.toBeString();
		await expect(
			new Bun.Transpiler({ loader: 'tsx' }).transform(nativeRouteRuntime)
		).resolves.toBeString();
		await expect(
			new Bun.Transpiler({ loader: 'ts' }).transform(authSource)
		).resolves.toBeString();
	});

	test('provisions Expo push registration only through native Auth', async () => {
		const { config, root } = await fixture(true);
		await writeFile(
			join(root, 'push-page.ts'),
			`import { pushNotifications } from '@absolutejs/devices'; void pushNotifications;`
		);
		await writeAbsoluteExpoProject(config, { projectRoot: root });
		const devices = await readFile(
			join(
				config.nativeProjectDirectory,
				'src',
				'generated',
				'AbsoluteDevices.ts'
			),
			'utf8'
		);
		expect(devices).toContain('createExpoPushNotificationsCapability');
		expect(devices).toContain("absoluteExpoAuth.fetch('/auth/push'");
		expect(devices).toContain('absolutejs.push.installation-id');
		expect(devices).toContain('beforeAbsoluteExpoDeviceSignOut');
		expect(devices).toContain('installation-ownership');
		expect(devices).toContain('onPrincipalChange');
		expect(devices).not.toContain('getExpoPushTokenAsync');
	});

	test('provisions one native-owned Sync store for WebView, native routes, and background work', async () => {
		const { config, root } = await fixture(true, true);
		await writeAbsoluteExpoProject(config, { projectRoot: root });
		const project = config.nativeProjectDirectory;
		const [appConfig, layout, packageSource, syncSource, webHost] =
			await Promise.all([
				readFile(join(project, 'app.json'), 'utf8'),
				readFile(join(project, 'app', '_layout.tsx'), 'utf8'),
				readFile(join(project, 'package.json'), 'utf8'),
				readFile(
					join(project, 'src', 'generated', 'AbsoluteSync.ts'),
					'utf8'
				),
				readFile(
					join(project, 'src', 'generated', 'AbsoluteWebHost.tsx'),
					'utf8'
				)
			]);

		expect(packageSource).toContain('@absolutejs/sync-expo');
		expect(packageSource).toContain('expo-background-task');
		expect(packageSource).toContain('expo-sqlite');
		expect(appConfig).toContain('expo-background-task');
		expect(layout).toContain('startAbsoluteExpoSync');
		expect(syncSource).toContain('createExpoSyncLocalStore');
		expect(syncSource).toContain('defineExpoSyncBackgroundTask');
		expect(syncSource).toContain('runHeadlessSync');
		expect(syncSource).toContain('createAbsoluteExpoSyncBridge');
		expect(syncSource).toContain('absoluteExpoAuth.socketTicket');
		expect(syncSource).not.toContain('native-secret-ticket');
		expect(webHost).toContain("message.method.startsWith('sync.')");
		expect(webHost).toContain('const BRIDGE_FORMAT = 3');
		expect(webHost).not.toContain('socketTicket');
		await expect(
			new Bun.Transpiler({ loader: 'tsx' }).transform(webHost)
		).resolves.toBeString();
		await expect(
			new Bun.Transpiler({ loader: 'ts' }).transform(syncSource)
		).resolves.toBeString();
	});

	test('configures Expo Updates with the generated AbsoluteJS runtime identity', async () => {
		const { config, root } = await fixture(false, false, true);
		await writeAbsoluteExpoProject(config, { projectRoot: root });
		const project = config.nativeProjectDirectory;
		const [appConfig, packageSource] = await Promise.all([
			readFile(join(project, 'app.json'), 'utf8'),
			readFile(join(project, 'package.json'), 'utf8')
		]);
		const app = JSON.parse(appConfig).expo;

		expect(app.runtimeVersion).toMatch(/^[a-f0-9]{64}$/u);
		expect(app.updates).toEqual({
			checkAutomatically: 'NEVER',
			fallbackToCacheTimeout: 20_000,
			requestHeaders: {
				'x-absolute-mobile-app': 'com.example.product',
				'x-absolute-mobile-channel': 'production'
			},
			url: 'https://api.example.com/__absolute/mobile/updates/production/update.json'
		});
		expect(packageSource).toContain('"expo-updates": "~57.0.19"');
		expect(packageSource).toContain('"expo-crypto": "~57.0.1"');
		const updateRuntime = await readFile(
			join(project, 'src', 'generated', 'AbsoluteUpdates.ts'),
			'utf8'
		);
		expect(updateRuntime).toContain('setUpdateRequestHeadersOverride');
		expect(updateRuntime).toContain('x-absolute-mobile-installation');
		expect(updateRuntime).toContain('SecureStore.setItemAsync');
		expect(updateRuntime).toContain('Updates.fetchUpdateAsync');
		expect(updateRuntime).toContain('result.isRollBackToEmbedded');
	});

	test('does not adopt a populated custom directory without force', async () => {
		const { config, root } = await fixture();
		await mkdir(config.nativeProjectDirectory, { recursive: true });
		await writeFile(
			join(config.nativeProjectDirectory, 'README.md'),
			'mine'
		);

		await expect(
			writeAbsoluteExpoProject(config, { projectRoot: root })
		).rejects.toThrow('not AbsoluteJS-managed');
	});
});
