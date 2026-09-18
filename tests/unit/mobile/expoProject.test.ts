import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { normalizeAbsoluteMobileConfig } from '../../../src/mobile/config';
import {
	syncAbsoluteExpoWebAssets,
	writeAbsoluteExpoProject
} from '../../../src/mobile/expoProject';
import { createExpoTestCertificate } from '../../helpers/expoCodeSigning';
import { runInNewContext } from 'node:vm';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});

const fixture = async (
	auth = false,
	sync = false,
	updates = false,
	codeSigning = false
) => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-expo-project-'));
	temporaryDirectories.push(root);
	await mkdir(join(root, 'mobile', 'native'), { recursive: true });
	await writeFile(
		join(root, 'mobile', 'native', 'scanner.tsx'),
		'export default function Scanner() { return null; }\n'
	);
	if (codeSigning) {
		await mkdir(join(root, 'certs'), { recursive: true });
		await writeFile(
			join(root, 'certs', 'expo-update.pem'),
			createExpoTestCertificate()
		);
	}
	await writeFile(
		join(root, 'package.json'),
		JSON.stringify({
			dependencies: {
				...(auth ? { '@absolutejs/auth': '0.76.3' } : {}),
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
			observability: {
				environment: 'production',
				project: 'project-1'
			},
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
							...(codeSigning
								? {
										expoCodeSigning: {
											certificatePath:
												'certs/expo-update.pem',
											keyId: 'production-2026'
										}
									}
								: {}),
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
	test('does not report bridge installation as rendered content', async () => {
		const { config, root } = await fixture();
		await writeAbsoluteExpoProject(config, { projectRoot: root });
		const host = await readFile(
			join(
				config.nativeProjectDirectory,
				'src/generated/AbsoluteWebHost.tsx'
			),
			'utf8'
		);
		const functionSource = host.slice(
			host.indexOf('const bridgeBootstrap ='),
			host.indexOf('const bridgeFetch =')
		);
		const executable = new Bun.Transpiler({ loader: 'ts' }).transformSync(
			functionSource
		);
		const script = runInNewContext(
			`${
				executable
			}\nbridgeBootstrap("/", { top: 0, bottom: 0, left: 0, right: 0 });`,
			{ DEV_ORIGIN: undefined }
		);
		const boot = () => {
			const events = new Map<string, () => void>();
			const messages: Record<string, unknown>[] = [];
			runInNewContext(script, {
				document: { addEventListener() {} },
				TextEncoder,
				window: {
					ReactNativeWebView: {
						postMessage: (value: string) =>
							messages.push(JSON.parse(value))
					}
				},
				addEventListener: (name: string, listener: () => void) =>
					events.set(name, listener)
			});

			return { events, messages };
		};
		const healthy = boot();
		expect(healthy.messages).toEqual([]);
		healthy.events.get('absolute:shell-rendered')?.();
		expect(healthy.messages).toEqual([
			{ event: 'shell-rendered', format: 3, kind: 'event', path: '/' }
		]);
		healthy.events.get('error')?.();
		expect(healthy.messages).toHaveLength(1);
		const failed = boot();
		failed.events.get('unhandledrejection')?.();
		expect(failed.messages).toEqual([
			{ event: 'startup-failed', format: 3, kind: 'event', path: '/' }
		]);
		const messageSource = host.slice(
			host.indexOf('\tconst onMessage ='),
			host.indexOf('\n\tif (startupError)')
		);
		const indexUri =
			'https://appassets.androidplatform.net/absolutejs/amexpo_test/index.html?absolutePath=%2F';
		let readyCount = 0;
		const receive = runInNewContext(
			`${new Bun.Transpiler({ loader: 'ts' }).transformSync(messageSource)}\nonMessage;`,
			{
				activeWebPath: { current: '/' },
				BRIDGE_FORMAT: 3,
				DEV_ORIGIN: undefined,
				embeddedReadyReported: { current: false },
				indexUri,
				MAX_MESSAGE_BYTES: 65536,
				PRODUCTION_ORIGIN: 'https://api.example.com',
				TextEncoder,
				URL,
				isNativeRoute: () => false,
				markAbsoluteEmbeddedWebReady: () => {
					readyCount += 1;
				}
			}
		) as (event: unknown) => Promise<void>;
		const data = JSON.stringify({
			event: 'shell-rendered',
			format: 3,
			kind: 'event',
			path: '/'
		});
		for (const url of [
			undefined,
			'https://api.example.com/',
			indexUri.replace('amexpo_test', 'amexpo_other'),
			indexUri.replace('.net/', '.net.evil/')
		]) {
			await receive({ nativeEvent: { data, url } });
		}
		expect(readyCount).toBe(0);
		await receive({ nativeEvent: { data, url: indexUri } });
		expect(readyCount).toBe(1);
	});
	test('embeds the configured Expo code-signing root and metadata', async () => {
		const { config, root } = await fixture(false, false, true, true);
		await writeAbsoluteExpoProject(config, { projectRoot: root });
		const project = config.nativeProjectDirectory;
		const [appConfigSource, dynamicConfig, generatedCertificate] =
			await Promise.all([
				readFile(join(project, 'app.json'), 'utf8'),
				readFile(join(project, 'app.config.js'), 'utf8'),
				readFile(
					join(project, 'certs', 'absolute-mobile-update.pem'),
					'utf8'
				)
			]);
		const appConfig = JSON.parse(appConfigSource);

		expect(appConfig.expo.updates.codeSigningCertificate).toBe(
			'./certs/absolute-mobile-update.pem'
		);
		expect(appConfig.expo.updates.codeSigningMetadata).toEqual({
			alg: 'rsa-v1_5-sha256',
			keyid: 'production-2026'
		});
		const configuredCertificate = config.updates?.expoCodeSigning;
		if (!configuredCertificate)
			throw new Error('Normalized Expo code signing is missing.');
		expect(generatedCertificate).toBe(configuredCertificate.certificatePem);
		expect(dynamicConfig).toContain(
			'delete config.expo.updates.codeSigningCertificate'
		);
	});

	test('generates a CNG shell with explicit native ownership and web catch-all', async () => {
		const { config, root } = await fixture();
		const first = await writeAbsoluteExpoProject(config, {
			projectRoot: root
		});
		const second = await writeAbsoluteExpoProject(config, {
			projectRoot: root
		});
		const project = config.nativeProjectDirectory;
		const metro = await readFile(join(project, 'metro.config.js'), 'utf8');
		expect(metro).toContain('process.env.ABSOLUTE_EXPO_APP_ROOT');
		expect(metro).not.toContain('resolveRequest');
		const expoConfig = JSON.parse(
			await readFile(join(project, 'app.json'), 'utf8')
		);
		expect(expoConfig.expo.experiments.tsconfigPaths).toBe(false);
		const [
			appConfig,
			dynamicConfig,
			layout,
			nativeRoute,
			nativeObservability,
			nativeObservabilityConfig,
			nativeObservabilityAndroid,
			nativeObservabilityAndroidManifest,
			nativeObservabilityIos,
			packageSource,
			plugin,
			activityResultPlugin,
			nativeRouteRuntime,
			webAssets,
			webHost
		] = await Promise.all([
			readFile(join(project, 'app.json'), 'utf8'),
			readFile(join(project, 'app.config.js'), 'utf8'),
			readFile(join(project, 'app', '_layout.tsx'), 'utf8'),
			readFile(join(project, 'app', 'scanner', 'index.tsx'), 'utf8'),
			readFile(
				join(
					project,
					'src',
					'generated',
					'AbsoluteNativeObservability.ts'
				),
				'utf8'
			),
			readFile(
				join(
					project,
					'modules/absolute-mobile-observability/expo-module.config.json'
				),
				'utf8'
			),
			readFile(
				join(
					project,
					'modules/absolute-mobile-observability/android/src/main/java/expo/modules/absolutemobileobservability/AbsoluteMobileObservabilityModule.kt'
				),
				'utf8'
			),
			readFile(
				join(
					project,
					'modules/absolute-mobile-observability/android/src/main/AndroidManifest.xml'
				),
				'utf8'
			),
			readFile(
				join(
					project,
					'modules/absolute-mobile-observability/ios/AbsoluteMobileObservabilityModule.swift'
				),
				'utf8'
			),
			readFile(join(project, 'package.json'), 'utf8'),
			readFile(
				join(project, 'plugins', 'withAbsoluteDevelopmentCa.js'),
				'utf8'
			),
			readFile(
				join(
					project,
					'plugins',
					'withAbsoluteActivityResultRecovery.js'
				),
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
		expect(appConfig).toContain(
			'./plugins/withAbsoluteActivityResultRecovery'
		);
		expect(activityResultPlugin).toContain(
			'AbsoluteActivityResultRecoveryState.enqueueActivityResult'
		);
		expect(activityResultPlugin).toContain(
			'AbsoluteActivityResultRecoveryState.applicationRuntimeReady'
		);
		expect(activityResultPlugin).toContain(
			'AbsoluteActivityResultRecoveryState.applicationRuntimeReady = false'
		);
		expect(layout).toContain('useActivityResultRecoveryEffect(() => {');
		expect(layout).toContain('markAbsoluteApplicationRuntimeReady()');
		const activityResultRuntime = await readFile(
			join(project, 'src/generated/AbsoluteActivityResultRecovery.ts'),
			'utf8'
		);
		expect(activityResultRuntime).toContain('markAbsoluteEmbeddedWebReady');
		expect(activityResultRuntime).toContain('markAbsoluteEmbeddedWebPhase');
		expect(
			await readFile(
				join(
					project,
					'modules/absolute-activity-result-recovery/android/src/main/java/expo/modules/absoluteactivityresultrecovery/AbsoluteActivityResultRecoveryModule.kt'
				),
				'utf8'
			)
		).toContain('Expo embedded web content ready');
		expect(
			await readFile(
				join(
					project,
					'modules/absolute-activity-result-recovery/ios/AbsoluteActivityResultRecoveryModule.swift'
				),
				'utf8'
			)
		).toContain('Expo embedded web content ready; version=%@; build=%@');
		expect(webHost).toContain('markAbsoluteEmbeddedWebReady()');
		expect(webHost).toContain("error.message === 'assets-download-failed'");
		expect(webHost).toContain(
			"markAbsoluteEmbeddedWebPhase('devices-failed')"
		);
		expect(webHost).toContain('Embedded content could not start.');
		expect(appConfig).toContain('"scheme": "product"');
		expect(nativeRoute).toContain('mobile/native/scanner');
		expect(nativeRoute).toContain('createAbsoluteNativeRoute');
		expect(nativeRouteRuntime).toContain(
			'application/vnd.absolute.native-route+json'
		);
		expect(nativeRouteRuntime).toContain(
			'createAbsoluteNativeRouteErrorBoundary'
		);
		expect(nativeRouteRuntime).toContain("phase: 'native-route-load'");
		expect(nativeRouteRuntime).toContain("phase: 'native-route-render'");
		expect(nativeRouteRuntime).toContain('mobileAppBuild');
		expect(webHost).toContain('const canGoBack = useRef(false)');
		expect(webHost).toContain('canGoBack.current = state.canGoBack');
		expect(webHost).toContain(
			'if (canGoBack.current) webView.current?.goBack()'
		);
		expect(webHost).toContain(
			'activeWebPath.current = route.pathname + route.search + route.hash'
		);
		expect(webHost).toContain(
			'const webSource = useMemo(() => indexUri ? { uri: indexUri } : undefined, [indexUri])'
		);
		expect(webHost).toContain('source={webSource}');
		expect(webHost).toContain(
			'export type AbsoluteWebHostProps = { path?: string }'
		);
		expect(webHost).toContain(
			"path?.startsWith('/') && !path.startsWith('//') ? path : routerPathname"
		);
		expect(layout).toContain('startAbsoluteExpoNativeObservability');
		expect(nativeObservability).toContain('requireNativeModule');
		expect(nativeObservability).toContain('if (response.ok)');
		expect(nativeObservability).toContain('nativeDiagnosticId');
		expect(nativeObservabilityConfig).toContain(
			'AbsoluteMobileObservabilityModule'
		);
		expect(JSON.parse(nativeObservabilityConfig).platforms).toEqual([
			'apple',
			'android'
		]);
		expect(nativeObservabilityAndroid).toContain(
			'getHistoricalProcessExitReasons'
		);
		expect(nativeObservabilityAndroid).toContain(
			'ApplicationInfo.FLAG_DEBUGGABLE'
		);
		expect(nativeObservabilityAndroid).toContain('crashForTesting');
		expect(nativeObservabilityAndroid).toContain('CRASH_TEST_KEY');
		expect(nativeObservability).toContain(
			'crashAbsoluteExpoNativeObservabilityForTesting'
		);
		expect(nativeObservability).toContain(
			'enqueueAbsoluteExpoNativeObservabilityForTesting'
		);
		expect(nativeObservabilityAndroid).toContain('MAX_REPORTS = 8');
		expect(nativeObservabilityAndroidManifest).toStartWith('<!--');
		expect(nativeObservabilityAndroidManifest).not.toContain(
			'// Generated'
		);
		expect(nativeObservabilityIos).toContain('MXMetricManagerSubscriber');
		expect(nativeObservabilityIos).toContain('maximumReports = 8');
		expect(nativeObservabilityIos).toContain('#if DEBUG');
		expect(nativeObservabilityIos).toContain('enqueueForTesting');
		expect(nativeObservabilityIos).toContain(
			'token=mobile-observability-secret'
		);
		expect(nativeRouteRuntime).toContain('redactErrorText');
		expect(nativeRoute).toContain('export const ErrorBoundary');
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
		expect(webHost).not.toContain("event: 'ready'");
		expect(webHost).toContain("message.event === 'shell-rendered'");
		expect(webHost).toContain('const sourceUrl = event.nativeEvent.url');
		expect(webHost).toContain("setStartupError('content')");
		expect(webHost).toContain('absoluteEmbeddedNativeConfig');
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

	test('removes only generated native observability files when disabled', async () => {
		const { config, root } = await fixture();
		await writeAbsoluteExpoProject(config, { projectRoot: root });
		const project = config.nativeProjectDirectory;
		const runtime = join(
			project,
			'src',
			'generated',
			'AbsoluteNativeObservability.ts'
		);
		const module = join(
			project,
			'modules',
			'absolute-mobile-observability',
			'expo-module.config.json'
		);
		delete config.observability;

		const result = await writeAbsoluteExpoProject(config, {
			projectRoot: root
		});

		expect(result.changed).toBeGreaterThan(0);
		await expect(readFile(runtime, 'utf8')).rejects.toThrow();
		await expect(readFile(module, 'utf8')).rejects.toThrow();
		expect(
			await readFile(join(project, 'app', '_layout.tsx'), 'utf8')
		).not.toContain('AbsoluteNativeObservability');
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
					observability: {
						endpoint:
							'https://api.example.com/api/observability/errors',
						environment: 'production',
						project: 'project-1',
						sampleRate: 1
					},
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
		expect(source).toContain(
			'if (!asset.localUri) asset = await asset.downloadAsync()'
		);
		expect(source).toContain('const ARCHIVE_MODULE = require(');
		expect(source).toContain('await source.copy(archive)');
		expect(source).toContain(
			'await copyLegacyAsync({ from: asset.localUri'
		);
		expect(source).toContain('contents = await archive.bytes()');
		expect(source).toContain('contents.slice(entry.offset');
		expect(source).toContain("throw new Error('assets-read-failed')");
		expect(source).toContain("throw new Error('assets-write-failed')");
		expect(source).toContain('ABSOLUTE_MOBILE_MANIFEST');
		expect(source).toContain('react:Product:schema-product');
		expect(source).toContain(
			'https://api.example.com/api/observability/errors'
		);
		expect(source).not.toContain('"method":"POST"');
		expect(source).not.toContain('must-not-be-embedded');

		const archiveBytes = await readFile(
			join(result.path, 'bundle.absasset')
		);
		const md5 = (bytes: Uint8Array) =>
			createHash('md5').update(bytes).digest('hex');
		const executable = new Bun.Transpiler({ loader: 'ts' }).transformSync(
			source.replace(/^import .*;$/gmu, '').replace(/^export /gmu, '')
		);
		const exercise = async (
			mode:
				| 'valid'
				| 'wrong-resource'
				| 'truncated-archive'
				| 'corrupt-archive'
				| 'short-write'
				| 'stale-cache'
		) => {
			const storage = new Map<string, Uint8Array>();
			let registered = 0;
			let input: Uint8Array = archiveBytes;
			if (mode === 'truncated-archive')
				input = archiveBytes.subarray(0, 4);
			if (mode === 'corrupt-archive')
				input = new Uint8Array(archiveBytes.length);
			storage.set('source', input);
			class Directory {
				uri: string;
				constructor(...parts: (string | Directory)[]) {
					this.uri = parts
						.map((part) =>
							typeof part === 'string' ? part : part.uri
						)
						.join('/');
				}
				create() {}
			}
			class File extends Directory {
				get exists() {
					return storage.has(this.uri);
				}
				get size() {
					return storage.get(this.uri)?.byteLength ?? 0;
				}
				get md5() {
					const bytes = storage.get(this.uri);

					return bytes ? md5(bytes) : null;
				}
				delete() {
					storage.delete(this.uri);
				}
				async copy(destination: File) {
					storage.set(destination.uri, await this.bytes());
				}
				async bytes() {
					const bytes = storage.get(this.uri);
					if (!bytes) throw new Error('Missing mock file');

					return bytes;
				}
				write(bytes: Uint8Array) {
					storage.set(
						this.uri,
						mode === 'short-write' ? bytes.slice(0, 1) : bytes
					);
				}
			}
			if (mode === 'stale-cache')
				storage.set(
					`files/absolutejs-web/${result.bundleId}/index.html`,
					new Uint8Array('<main></main>'.length)
				);
			const run = runInNewContext(
				`${executable}\nmaterializeAbsoluteWebBundle;`,
				{
					Asset: {
						fromModule: () => ({
							hash: md5(archiveBytes),
							localUri: 'source',
							type: mode === 'wrong-resource' ? 'png' : 'absasset'
						})
					},
					Directory,
					File,
					Paths: { document: 'files' },
					registerAbsoluteEmbeddedBundle: () => {
						registered++;

						return 'registered';
					},
					require: () => 1
				}
			) as () => Promise<string>;
			if (mode === 'valid' || mode === 'stale-cache') {
				expect(await run()).toBe('registered');
				expect(
					Buffer.from(
						storage.get(
							`files/absolutejs-web/${result.bundleId}/index.html`
						) ?? new Uint8Array()
					).toString()
				).toBe('<main></main>');
				expect(registered).toBe(1);
			} else {
				await expect(run()).rejects.toThrow(
					mode === 'wrong-resource'
						? 'assets-identity-failed'
						: 'assets-integrity-failed'
				);
				expect(registered).toBe(0);
			}
		};
		for (const mode of [
			'valid',
			'wrong-resource',
			'truncated-archive',
			'corrupt-archive',
			'short-write',
			'stale-cache'
		] as const)
			await exercise(mode);
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
		expect(manifest).toContain('"@absolutejs/devices-expo": "0.0.11"');
		expect(manifest).toContain('"expo-image-manipulator": "57.0.14"');
		expect(devices).toContain('createExpoCameraCapability');
		expect(devices).toContain('createExpoClipboardCapability');
		expect(devices).toContain('createExpoDocumentsCapability');
		expect(devices).toContain('createExpoLocationCapability');
		expect(devices).toContain('createExpoShareCapability');
		expect(devices).toContain(
			'takeActivityResultCancellation: takeAbsoluteActivityResultCancellation'
		);
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

		expect(packageSource).toContain('"@absolutejs/auth": "0.76.3"');
		expect(packageSource).toContain('"@absolutejs/auth-expo": "0.0.6"');
		expect(packageSource).toContain('"expo-crypto": "~57.0.2"');
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

	test('rebinds the generated Sync bridge after login and isolates account transitions', async () => {
		const { config, root } = await fixture(true, true);
		await writeAbsoluteExpoProject(config, { projectRoot: root });
		const source = await readFile(
			join(
				config.nativeProjectDirectory,
				'src/generated/AbsoluteSync.ts'
			),
			'utf8'
		);
		const executable = new Bun.Transpiler({ loader: 'ts' }).transformSync(
			source
				.slice(
					source.indexOf('export const createAbsoluteExpoSyncBridge')
				)
				.replace('export const', 'const')
		);
		type Principal = { namespace: string } | undefined;
		let principal: Principal;
		let readPrincipal = async () => principal;
		const listeners = new Set<(value: Principal) => void>();
		const closed: string[] = [];
		const emitters: Array<(payload: Record<string, unknown>) => void> = [];
		const events: unknown[] = [];
		let releaseRequest: ((value: string) => void) | undefined;
		let releaseTicket: ((value: string) => void) | undefined;
		const ticketProviders: Array<() => Promise<string>> = [];
		const createBridge = runInNewContext(
			`${executable}\ncreateAbsoluteExpoSyncBridge;`,
			{
				absoluteExpoAuth: {
					onPrincipalChange: (
						listener: (value: Principal) => void
					) => {
						listeners.add(listener);

						return () => listeners.delete(listener);
					},
					principal: () => readPrincipal(),
					socketTicket: () =>
						new Promise<string>((resolve) => {
							releaseTicket = resolve;
						})
				},
				PRODUCTION_ORIGIN: 'https://example.test',
				store: {},
				createExpoSyncBridgeHost: ({
					namespace
				}: {
					namespace: string;
				}) => ({
					close: async () => {
						closed.push(namespace);
					},
					request: async (method: string) =>
						method === 'sync.pending'
							? new Promise<string>((resolve) => {
									releaseRequest = resolve;
								})
							: namespace
				}),
				createExpoSyncSocketBridgeHost: ({
					emit,
					socketTicket
				}: {
					emit: (payload: Record<string, unknown>) => void;
					socketTicket: () => Promise<string>;
				}) => {
					emitters.push(emit);
					ticketProviders.push(socketTicket);

					return {
						close: async () => undefined,
						request: async () => undefined
					};
				},
				expoSyncRandomId: () => 'synthetic-id',
				installExpoSyncLifecycle: () => () => undefined,
				startAbsoluteExpoSync: async () => undefined
			}
		);
		const change = (value: Principal) => {
			principal = value;
			for (const listener of listeners) listener(value);
		};
		const bridge = await createBridge((...args: unknown[]) =>
			events.push(args)
		);
		await expect(bridge.request('sync.read', {})).rejects.toThrow(
			'authenticated principal'
		);
		change({ namespace: 'account-a' });
		expect(await bridge.request('sync.read', {})).toBe('account-a');
		const pending = bridge.request('sync.pending', {});
		await Promise.resolve();
		expect(releaseRequest).toBeDefined();
		const [ticketProvider] = ticketProviders;
		if (!ticketProvider)
			throw new Error('Missing synthetic ticket provider');
		const ticket = ticketProvider();
		change({ namespace: 'account-b' });
		releaseTicket?.('synthetic-delayed-ticket');
		await expect(ticket).rejects.toThrow('principal changed');
		emitters[0]?.({ oldAccount: true });
		releaseRequest?.('private account-a response');
		await expect(pending).rejects.toThrow('principal changed');
		await expect(bridge.request('sync.read', {})).rejects.toThrow(
			'principal changed'
		);
		expect(closed).toEqual(['account-a']);
		expect(events).toEqual([]);
		change({ namespace: 'account-a' });
		await expect(bridge.request('sync.read', {})).rejects.toThrow(
			'principal changed'
		);
		await bridge.close();
		change({ namespace: 'account-b' });
		const nextBridge = await createBridge((...args: unknown[]) =>
			events.push(args)
		);
		expect(await nextBridge.request('sync.read', {})).toBe('account-b');
		emitters[1]?.({ currentAccount: true });
		expect(events).toHaveLength(1);
		change(undefined);
		await expect(nextBridge.request('sync.read', {})).rejects.toThrow(
			'principal changed'
		);
		await nextBridge.close();
		expect(closed).toEqual(['account-a', 'account-b']);
		const lastBridge = await createBridge(() => undefined);
		change({ namespace: 'skipped-account' });
		const superseded = lastBridge.request('sync.read', {});
		change({ namespace: 'account-a' });
		await expect(superseded).rejects.toThrow('principal changed');
		expect(await lastBridge.request('sync.read', {})).toBe('account-a');
		change({ namespace: 'never-mounted-account' });
		await lastBridge.close();
		await lastBridge.close();
		expect(listeners.size).toBe(0);
		expect(closed).toEqual(['account-a', 'account-b', 'account-a']);
		expect(emitters).toHaveLength(3);
		await expect(bridge.request('sync.read', {})).rejects.toThrow(
			'principal changed'
		);
		const readStarted = Promise.withResolvers<void>();
		const initialPrincipal = Promise.withResolvers<Principal>();
		readPrincipal = () => {
			readStarted.resolve();

			return initialPrincipal.promise;
		};
		const starting = createBridge(() => undefined);
		await readStarted.promise;
		change({ namespace: 'latest-account' });
		initialPrincipal.resolve({ namespace: 'stale-startup-account' });
		const started = await starting;
		expect(await started.request('sync.read', {})).toBe('latest-account');
		await started.close();
		expect(closed).toEqual([
			'account-a',
			'account-b',
			'account-a',
			'latest-account'
		]);
		expect(listeners.size).toBe(0);
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

		expect(packageSource).toContain('"@absolutejs/sync-expo": "0.0.4"');
		expect(packageSource).toContain('expo-background-task');
		expect(packageSource).toContain('expo-sqlite');
		expect(appConfig).toContain('expo-background-task');
		expect(layout).toContain('startAbsoluteExpoSync');
		expect(syncSource).toContain('createExpoSyncLocalStore');
		expect(syncSource).toContain('createId: expoSyncRandomId');
		expect(syncSource).toContain('removeRuntimeTransport?.()');
		expect(syncSource).toContain('installRuntimeTransport(principal)');
		expect(syncSource).toContain(
			'if (previousNamespace !== undefined) void Updates.reloadAsync()'
		);
		expect(syncSource).toContain('getAbsoluteExpoSyncSchemaStatus');
		expect(syncSource).toContain('defineExpoSyncBackgroundTask');
		expect(syncSource).toContain(
			'void registerExpoSyncBackgroundTask(BACKGROUND_TASK'
		);
		expect(syncSource).toContain(
			'AbsoluteJS could not register Expo background Sync.'
		);
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
			checkAutomatically: 'ON_ERROR_RECOVERY',
			fallbackToCacheTimeout: 20_000,
			requestHeaders: {
				'x-absolute-mobile-app': 'com.example.product',
				'x-absolute-mobile-channel': 'production'
			},
			url: 'https://api.example.com/__absolute/mobile/updates/production/update.json'
		});
		expect(packageSource).toContain('"expo-updates": "~57.0.19"');
		expect(packageSource).toContain('"expo-crypto": "~57.0.2"');
		const updateRuntime = await readFile(
			join(project, 'src', 'generated', 'AbsoluteUpdates.ts'),
			'utf8'
		);
		expect(updateRuntime).toContain('setExtraParamAsync');
		expect(updateRuntime).toContain('absolute-installation');
		expect(updateRuntime).toContain('SecureStore.setItemAsync');
		expect(updateRuntime).toContain('Updates.fetchUpdateAsync');
		expect(updateRuntime).toContain('PENDING_HEALTH_KEY');
		expect(updateRuntime).toContain("? 'activated' : 'rolled-back'");
		expect(updateRuntime).toContain('x-absolute-mobile-health-token');
		expect(updateRuntime).toContain('result.isRollBackToEmbedded');
		expect(updateRuntime).toContain('Updates.reloadAsync');
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
