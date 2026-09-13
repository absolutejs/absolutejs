import { afterAll, describe, expect, test } from 'bun:test';
import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
	convertCertificateToCertificatePEM,
	convertKeyPairToPEM,
	generateKeyPair,
	generateSelfSignedCodeSigningCertificate
} from '@expo/code-signing-certificates';
import {
	createMobileUpdateHandler,
	createMobileUpdateRegistry,
	type MobileUpdateRegistry,
	type MobileUpdateRolloutReport
} from '@absolutejs/deploy/mobile-update';
import type { NativeReleaseBlobStore } from '@absolutejs/deploy/native-release';
import { findFreePort } from '../../src/cli/utils';
import { normalizeAbsoluteMobileConfig } from '../../src/mobile/config';
import {
	absoluteExpoExecutable,
	installAbsoluteExpoAndroidRelease
} from '../../src/mobile/expoDevController';
import {
	finalizeAbsoluteExpoUpdateExport,
	type AbsoluteExpoUpdateDescriptor
} from '../../src/mobile/expoUpdate';
import { writeAbsoluteExpoProject } from '../../src/mobile/expoProject';
import { resolveAbsoluteMobileUpdateRuntime } from '../../src/mobile/updateRuntime';
import { isAbsoluteMobileUpdateRolloutMember } from '../../src/mobile/updateRollout';
import { buildAbsoluteMobileUpdate } from '../../src/mobile/updateSigning';
import {
	ABSOLUTE_ANDROID_AVD_NAME,
	absoluteManagedAndroidSdkRoot,
	detectAbsoluteMobileHost,
	inspectAbsoluteMobileToolchain
} from '../../src/mobile/emulatorDoctor';

const ENABLED = process.env.ABSOLUTE_TEST_NATIVE_EXPO_ANDROID_UPDATES === '1';
const describeNative = ENABLED ? describe : describe.skip;
const PROJECT_ROOT = resolve(import.meta.dir, '..', '..');
const FIXTURE_ROOT = resolve(PROJECT_ROOT, '.absolutejs/expo-android-update');
const NATIVE_PROJECT = resolve(FIXTURE_ROOT, 'native');
const EXPORT_ROOT = resolve(FIXTURE_ROOT, 'exports');
const RELEASE_ROOT = resolve(FIXTURE_ROOT, 'releases');
const ARTIFACT_ROOT = resolve(FIXTURE_ROOT, 'artifacts');
const APP_ID = 'com.absolutejs.expoupdateacceptance';
const CHANNEL = 'acceptance';
const KEY_ID = 'acceptance-ecdsa';
const EXPO_KEY_ID = 'acceptance-rsa';
const AUTH_SENTINEL = 'absolute-expo-ota-renewable-credential';
const SYNC_SENTINEL = 'absolute-expo-ota-private-mutation';
const COMMAND_ATTEMPTS = 3;
const COMMAND_TIMEOUT_MS = 30_000;
const COMMAND_RETRY_MS = 1_000;
const WAIT_TIMEOUT_MS = 120_000;
const EMULATOR_WAIT_TIMEOUT_MS = 180_000;

type ReleaseLabel =
	| 'embedded'
	| 'healthy'
	| 'bad-signature'
	| 'corrupt-asset'
	| 'incompatible'
	| 'interrupted'
	| 'broken'
	| 'recovery'
	| 'rollout-excluded'
	| 'rollout-manual'
	| 'rollout-operator'
	| 'rollout-broken'
	| 'rollout-automatic';
type AppReport = {
	authRetained?: boolean;
	embedded?: boolean;
	encryptedAtRest?: boolean;
	message?: string;
	pending?: number;
	release?: ReleaseLabel;
	updateId?: string | null;
};
type Fault = 'asset' | 'delay-asset' | 'signature' | undefined;
type PublishOptions = { eligible?: boolean; rollout?: number };
type StoredBlob = {
	bytes: Uint8Array;
	metadata?: Record<string, string>;
};

let backend: ReturnType<typeof Bun.serve> | undefined;

const command = (executable: string, ...args: string[]) => {
	let failure = '';
	for (let attempt = 0; attempt < COMMAND_ATTEMPTS; attempt += 1) {
		const result = Bun.spawnSync([executable, ...args], {
			killSignal: 'SIGKILL',
			stderr: 'pipe',
			stdout: 'pipe',
			timeout: COMMAND_TIMEOUT_MS
		});
		if (result.exitCode === 0) return result.stdout.toString().trim();
		failure =
			result.stderr.toString().trim() || result.stdout.toString().trim();
		if (
			!failure.includes('UtilAcceptVsock') ||
			attempt === COMMAND_ATTEMPTS - 1
		)
			break;
		Bun.sleepSync(COMMAND_RETRY_MS);
	}

	throw new Error(`${executable} ${args.join(' ')} failed: ${failure}`);
};

const readyAndroidSerials = (adb: string) => {
	try {
		return command(adb, 'devices')
			.split(/\r?\n/u)
			.flatMap((line) => {
				const match = /^(\S+)\s+device$/u.exec(line.trim());

				return match?.[1] ? [match[1]] : [];
			});
	} catch {
		return [];
	}
};

const recoverWindowsAdb = async (adb: string) => {
	if (!adb.toLowerCase().endsWith('.exe')) return;
	Bun.spawnSync(['taskkill.exe', '/f', '/im', 'adb.exe'], {
		killSignal: 'SIGKILL',
		stderr: 'ignore',
		stdout: 'ignore',
		timeout: COMMAND_TIMEOUT_MS
	});
	await Bun.sleep(1_000);
};

const waitFor = async <T>(
	read: () => T | undefined,
	message: string,
	timeoutMs = WAIT_TIMEOUT_MS
) => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const value = read();
		if (value !== undefined) return value;
		await Bun.sleep(250);
	}
	throw new Error(message);
};

const memoryStore = (): NativeReleaseBlobStore => {
	const objects = new Map<string, StoredBlob>();

	return {
		delete: async (key) => void objects.delete(key),
		get: async (key) => objects.get(key)?.bytes ?? null,
		head: async (key) => {
			const value = objects.get(key);

			return value
				? {
						key,
						metadata: value.metadata,
						size: value.bytes.byteLength
					}
				: null;
		},
		list: async (options = {}) => ({
			objects: [...objects.entries()]
				.filter(([key]) => key.startsWith(options.prefix ?? ''))
				.map(([key, value]) => ({
					key,
					metadata: value.metadata,
					size: value.bytes.byteLength
				})),
			truncated: false
		}),
		put: async (key, body, options) => {
			let bytes: Uint8Array;
			if (typeof body === 'string')
				bytes = new TextEncoder().encode(body);
			else if (body instanceof Uint8Array) bytes = body;
			else bytes = new Uint8Array(await new Response(body).arrayBuffer());
			objects.set(key, {
				bytes: new Uint8Array(bytes),
				...(options?.metadata ? { metadata: options.metadata } : {})
			});
		}
	};
};

const appSource = (
	label: ReleaseLabel,
	origin: string
) => `import * as SecureStore from 'expo-secure-store';
import * as Updates from 'expo-updates';
import { createExpoSyncLocalStore, createExpoSyncProtection } from '@absolutejs/sync-expo';
import { Directory, File, Paths } from 'expo-file-system';
import { useEffect } from 'react';
import { Text, View } from 'react-native';

const ORIGIN = ${JSON.stringify(origin)};
const AUTH_KEY = 'absolutejs.auth.ota.acceptance.refresh';
const AUTH_VALUE = '${AUTH_SENTINEL}';
const SYNC_SEEDED_KEY = 'absolutejs.sync.ota.acceptance.seeded';
const OPERATION_ID = 'expo-ota-installation:mutation-1';
const containsBytes = (value, needle) => {
  outer: for (let offset = 0; offset <= value.length - needle.length; offset += 1) {
    for (let index = 0; index < needle.length; index += 1) {
      if (value[offset + index] !== needle[index]) continue outer;
    }
    return true;
  }
  return false;
};
const databaseIsEncrypted = async () => {
  const needle = Uint8Array.from(Array.from('${SYNC_SENTINEL}', value => value.charCodeAt(0)));
  const directory = new Directory(Paths.document, 'SQLite');
  if (!directory.exists) return false;
  for (const entry of directory.list()) {
    if (entry instanceof File && entry.name.startsWith('absolute-expo-ota.db')) {
      if (containsBytes(await entry.bytes(), needle)) return false;
    }
  }
  return true;
};
const store = createExpoSyncLocalStore({
  databaseName: 'absolute-expo-ota.db',
  protection: createExpoSyncProtection({ storagePrefix: 'absolutejs.expo.ota.' }),
  storageSchema: { components: [{ id: '@absolutejs/app', localData: { mutations: [{ match: 'ota:create', protection: 'required' }] }, version: 1 }] }
});

export default function ExpoUpdateAcceptance() {
  useEffect(() => {
    void (async () => {
      try {
        let credential = await SecureStore.getItemAsync(AUTH_KEY);
        if (!credential && '${label}' === 'embedded') {
          await SecureStore.setItemAsync(AUTH_KEY, AUTH_VALUE);
          credential = AUTH_VALUE;
        }
        let mutations = await store.transaction('principal-a', 'readonly', transaction => transaction.listMutations());
        const syncSeeded = await SecureStore.getItemAsync(SYNC_SEEDED_KEY);
        if (!syncSeeded && mutations.length === 0 && '${label}' === 'embedded') {
          await store.transaction('principal-a', 'readwrite', transaction => transaction.putMutation({
            args: { secret: '${SYNC_SENTINEL}' }, attempts: 0, createdAt: 1, inverse: [], name: 'ota:create', operationId: OPERATION_ID, optimistic: []
          }));
          await SecureStore.setItemAsync(SYNC_SEEDED_KEY, '1');
          mutations = await store.transaction('principal-a', 'readonly', transaction => transaction.listMutations());
        }
        if ('${label}' !== 'embedded') {
          for (const mutation of mutations) {
            const response = await fetch(ORIGIN + '/effect', {
              body: JSON.stringify({ operationId: mutation.operationId }), headers: { 'content-type': 'application/json' }, method: 'POST'
            });
            if (response.ok) await store.transaction('principal-a', 'readwrite', transaction => transaction.deleteMutation(mutation.operationId));
          }
          mutations = await store.transaction('principal-a', 'readonly', transaction => transaction.listMutations());
        }
        const encryptedAtRest = await databaseIsEncrypted();
        await fetch(ORIGIN + '/report', {
          body: JSON.stringify({ authRetained: credential === AUTH_VALUE, embedded: Updates.isEmbeddedLaunch, encryptedAtRest, pending: mutations.length, release: '${label}', updateId: Updates.updateId }),
          headers: { 'content-type': 'application/json' }, method: 'POST'
        });
      } catch (error) {
        await fetch(ORIGIN + '/report', {
          body: JSON.stringify({ message: error instanceof Error ? error.message : String(error), release: '${label}' }),
          headers: { 'content-type': 'application/json' }, method: 'POST'
        }).catch(() => undefined);
      }
    })();
  }, []);
  return <View><Text>AbsoluteJS Expo OTA ${label}</Text></View>;
}
`;

const brokenEntrySource = `import { registerRootComponent } from 'expo';

const neverCommit = new Promise<never>(() => undefined);
let reported = false;

function BrokenUpdate(): never {
  if (!reported) {
    reported = true;
    (globalThis as typeof globalThis & {
      ErrorUtils: { reportFatalError: (error: Error) => void };
    }).ErrorUtils.reportFatalError(
      new Error('intentional Expo OTA startup failure')
    );
  }
  throw neverCommit;
}

registerRootComponent(BrokenUpdate);
`;

const layoutSource = `import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { startAbsoluteExpoUpdates } from '../src/generated/AbsoluteUpdates';

export default function Layout() {
  useEffect(() => { void startAbsoluteExpoUpdates(); }, []);
  return <Stack screenOptions={{ headerShown: false }} />;
}
`;

const runExpoExport = async (
	executable: string,
	label: ReleaseLabel,
	runtimeVersion: string,
	origin: string
): Promise<{ descriptor: AbsoluteExpoUpdateDescriptor; directory: string }> => {
	const directory = resolve(EXPORT_ROOT, label);
	await rm(directory, { force: true, recursive: true });
	await writeFile(
		resolve(NATIVE_PROJECT, 'app/index.tsx'),
		appSource(label, origin)
	);
	const packagePath = resolve(NATIVE_PROJECT, 'package.json');
	const packageSource = await readFile(packagePath, 'utf8');
	if (label === 'broken' || label === 'rollout-broken') {
		const packageJson = JSON.parse(packageSource) as Record<
			string,
			unknown
		>;
		packageJson.main = './broken-entry.ts';
		await writeFile(
			resolve(NATIVE_PROJECT, 'broken-entry.ts'),
			brokenEntrySource
		);
		await writeFile(
			packagePath,
			`${JSON.stringify(packageJson, null, 2)}\n`
		);
	}
	try {
		const child = Bun.spawn(
			[
				executable,
				'export',
				'--platform',
				'android',
				'--output-dir',
				directory
			],
			{
				cwd: NATIVE_PROJECT,
				env: {
					...process.env,
					EXPO_PUBLIC_ABSOLUTE_UPDATE_ORIGIN:
						process.env.EXPO_PUBLIC_ABSOLUTE_UPDATE_ORIGIN,
					NODE_ENV: 'production'
				},
				stderr: 'inherit',
				stdout: 'inherit'
			}
		);
		if ((await child.exited) !== 0)
			throw new Error(`Expo ${label} update export failed.`);
	} finally {
		if (label === 'broken' || label === 'rollout-broken')
			await writeFile(packagePath, packageSource);
	}
	const app: unknown = JSON.parse(
		await readFile(resolve(NATIVE_PROJECT, 'app.json'), 'utf8')
	);
	if (typeof app !== 'object' || app === null)
		throw new Error('Generated Expo app config is invalid.');
	const expoConfig = Reflect.get(app, 'expo');
	if (typeof expoConfig !== 'object' || expoConfig === null)
		throw new Error('Generated Expo public config is invalid.');
	const result = await finalizeAbsoluteExpoUpdateExport({
		expoConfig: expoConfig as Record<string, unknown>,
		exportDirectory: directory,
		runtimeVersion
	});

	return { descriptor: result.descriptor, directory };
};

const publicKey = (key: KeyObject) =>
	key.export({ format: 'der', type: 'spki' }).toString('base64');

afterAll(() => backend?.stop(true));

describeNative('real Expo Android OTA conformance', () => {
	test('updates, rejects unsafe releases, recovers, and preserves native state', async () => {
		await rm(FIXTURE_ROOT, { force: true, recursive: true });
		await mkdir(FIXTURE_ROOT, { recursive: true });
		const port = await findFreePort();
		const origin = `http://localhost:${port}`;
		process.env.EXPO_PUBLIC_ABSOLUTE_UPDATE_ORIGIN = origin;
		const registrySigning = generateKeyPairSync('ec', {
			namedCurve: 'prime256v1'
		});
		const expoPair = generateKeyPair();
		const certificate = convertCertificateToCertificatePEM(
			generateSelfSignedCodeSigningCertificate({
				commonName: 'AbsoluteJS Expo OTA Acceptance',
				keyPair: expoPair,
				validityNotAfter: new Date('2036-01-01T00:00:00.000Z'),
				validityNotBefore: new Date('2026-01-01T00:00:00.000Z')
			})
		);
		const expoPrivateKey = convertKeyPairToPEM(expoPair).privateKeyPEM;
		await mkdir(resolve(FIXTURE_ROOT, 'certs'), { recursive: true });
		await writeFile(resolve(FIXTURE_ROOT, 'certs/expo.pem'), certificate);
		await writeFile(
			resolve(FIXTURE_ROOT, 'package.json'),
			`${JSON.stringify(
				{
					absolutejs: { sync: { localSchema: { version: 1 } } },
					dependencies: {
						'@absolutejs/auth': '0.76.3',
						'@absolutejs/sync': '2.31.0'
					},
					private: true
				},
				null,
				2
			)}\n`
		);
		const config = normalizeAbsoluteMobileConfig(
			{
				appId: APP_ID,
				appName: 'AbsoluteJS Expo OTA Acceptance',
				engine: 'expo',
				nativeProject: { directory: 'native' },
				platforms: ['android'],
				server: { productionOrigin: origin },
				updates: {
					channel: CHANNEL,
					expoCodeSigning: {
						certificatePath: 'certs/expo.pem',
						keyId: EXPO_KEY_ID
					},
					manifestUrl: `${origin}/__absolute/mobile/updates/${CHANNEL}/update.json`,
					publicKeys: {
						[KEY_ID]: publicKey(registrySigning.publicKey)
					}
				}
			},
			FIXTURE_ROOT
		);
		await writeAbsoluteExpoProject(config, {
			force: true,
			projectRoot: FIXTURE_ROOT
		});
		await mkdir(resolve(NATIVE_PROJECT, 'plugins'), { recursive: true });
		await Promise.all([
			writeFile(resolve(NATIVE_PROJECT, 'app/_layout.tsx'), layoutSource),
			writeFile(
				resolve(NATIVE_PROJECT, 'app/index.tsx'),
				appSource('embedded', origin)
			),
			writeFile(
				resolve(NATIVE_PROJECT, 'plugins/with-acceptance-cleartext.js'),
				`const { withAndroidManifest } = require('@expo/config-plugins');
module.exports = config => withAndroidManifest(config, value => {
  value.modResults.manifest.application[0].$['android:usesCleartextTraffic'] = 'true';
  return value;
});
`
			)
		]);
		const appJson = JSON.parse(
			await readFile(resolve(NATIVE_PROJECT, 'app.json'), 'utf8')
		);
		appJson.expo.plugins.push('./plugins/with-acceptance-cleartext.js');
		await writeFile(
			resolve(NATIVE_PROJECT, 'app.json'),
			`${JSON.stringify(appJson, null, 2)}\n`
		);
		const install = Bun.spawn(['bun', 'install'], {
			cwd: NATIVE_PROJECT,
			stderr: 'inherit',
			stdout: 'inherit'
		});
		if ((await install.exited) !== 0)
			throw new Error('Expo OTA dependency installation failed.');

		const createRegistry = (automatic?: boolean) =>
			createMobileUpdateRegistry({
				...(automatic === undefined
					? {}
					: {
							health: {
								autoPause: {
									failureRate: 0.5,
									minimumReports: 1
								},
								secret: 'absolutejs-expo-rollout-conformance-secret'
							},
							rollout: {
								automatic,
								stages: [
									{
										maximumFailureRate: 0.25,
										minimumReports: 1,
										observationMs: 0,
										rollout: 0.5
									},
									{
										maximumFailureRate: 0.25,
										minimumReports: 1,
										observationMs: 0,
										rollout: 1
									}
								]
							}
						}),
				publicKeys: {
					[KEY_ID]: publicKey(registrySigning.publicKey)
				},
				store: memoryStore()
			});
		const createHandler = (target: MobileUpdateRegistry) => {
			const { recordUpdateHealth } = target;

			return createMobileUpdateHandler({
				allowedOrigins: [],
				appId: APP_ID,
				channel: CHANNEL,
				expoCodeSigning: {
					keys: {
						[EXPO_KEY_ID]: {
							certificate,
							privateKey: expoPrivateKey
						}
					}
				},
				registry: recordUpdateHealth
					? {
							...target,
							recordUpdateHealth: async (input) => {
								try {
									return await recordUpdateHealth(input);
								} catch (error) {
									healthErrors.push(
										error instanceof Error
											? error.message
											: String(error)
									);
									throw error;
								}
							}
						}
					: target
			});
		};
		const healthErrors: string[] = [];
		let registry = createRegistry();
		let updateHandler = createHandler(registry);
		let fault: Fault;
		let delayedAssetStarted = false;
		let releaseDelayedAsset: (() => void) | undefined;
		let updateInstallationId: string | undefined;
		const delayedAsset = new Promise<void>((_resolve) => {
			releaseDelayedAsset = _resolve;
		});
		const reports: AppReport[] = [];
		const requestCounts = new Map<string, number>();
		const effects = new Set<string>();
		backend = Bun.serve({
			hostname: '127.0.0.1',
			port,
			fetch: async (request) => {
				const url = new URL(request.url);
				requestCounts.set(
					url.pathname,
					(requestCounts.get(url.pathname) ?? 0) + 1
				);
				if (url.pathname === '/report' && request.method === 'POST') {
					reports.push((await request.json()) as AppReport);

					return new Response(null, { status: 204 });
				}
				if (url.pathname === '/effect' && request.method === 'POST') {
					const value = (await request.json()) as {
						operationId?: string;
					};
					if (value.operationId) effects.add(value.operationId);

					return new Response(null, { status: 204 });
				}
				if (
					url.pathname.startsWith(
						`/__absolute/mobile/updates/${CHANNEL}/`
					)
				) {
					const extraParameters =
						request.headers.get('expo-extra-params');
					const installationMatch =
						/absolute-installation="([0-9a-f-]+)"/u.exec(
							extraParameters ?? ''
						);
					const [, matchedInstallationId] = installationMatch ?? [];
					if (
						matchedInstallationId &&
						/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
							matchedInstallationId
						)
					)
						updateInstallationId = matchedInstallationId;
					const response = await updateHandler(request);
					if (
						fault === 'signature' &&
						url.pathname.endsWith('/update.json')
					) {
						const headers = new Headers(response.headers);
						headers.set(
							'expo-signature',
							`sig="${Buffer.alloc(256).toString('base64')}", keyid="${EXPO_KEY_ID}", alg="rsa-v1_5-sha256"`
						);

						return new Response(await response.arrayBuffer(), {
							headers,
							status: response.status
						});
					}
					if (fault === 'asset' && url.pathname.includes('/files/')) {
						return new Response('corrupt');
					}
					if (
						fault === 'delay-asset' &&
						url.pathname.includes('/files/') &&
						!delayedAssetStarted
					) {
						delayedAssetStarted = true;
						await delayedAsset;
					}

					return response;
				}

				return new Response('Not found', { status: 404 });
			}
		});

		const host = detectAbsoluteMobileHost();
		const checks = await inspectAbsoluteMobileToolchain({ host });
		const managedAdb = resolve(
			absoluteManagedAndroidSdkRoot(host),
			'platform-tools',
			host === 'windows' || host === 'wsl' ? 'adb.exe' : 'adb'
		);
		const adb =
			checks.find(({ id }) => id === 'android.adb')?.path ??
			((await Bun.file(managedAdb).exists()) ? managedAdb : undefined);
		if (!adb) throw new Error('Expo OTA acceptance requires Android adb.');
		let existing = readyAndroidSerials(adb).find((value) =>
			value.startsWith('emulator-')
		);
		if (!existing) {
			await recoverWindowsAdb(adb);
			existing = readyAndroidSerials(adb).find((value) =>
				value.startsWith('emulator-')
			);
		}
		if (!existing) {
			const emulator = checks.find(
				({ id }) => id === 'android.emulator'
			)?.path;
			if (!emulator)
				throw new Error(
					'Expo OTA acceptance requires Android Emulator. Run `absolute mobile doctor android --fix`.'
				);
			const launched = Bun.spawn(
				[
					emulator,
					'-avd',
					ABSOLUTE_ANDROID_AVD_NAME,
					'-netdelay',
					'none',
					'-netspeed',
					'full'
				],
				{ stderr: 'ignore', stdin: 'ignore', stdout: 'ignore' }
			);
			launched.unref();
			existing = await waitFor(
				() => {
					const serial = readyAndroidSerials(adb).find((value) =>
						value.startsWith('emulator-')
					);
					if (!serial) return undefined;
					try {
						return command(
							adb,
							'-s',
							serial,
							'shell',
							'getprop',
							'sys.boot_completed'
						) === '1'
							? serial
							: undefined;
					} catch {
						return undefined;
					}
				},
				'Expo OTA acceptance could not boot the managed Android emulator.',
				EMULATOR_WAIT_TIMEOUT_MS
			);
		}
		if (!existing)
			throw new Error(
				'Expo OTA acceptance requires a ready Android emulator.'
			);
		Bun.spawnSync([adb, '-s', existing, 'uninstall', APP_ID], {
			stderr: 'ignore',
			stdout: 'ignore',
			timeout: COMMAND_TIMEOUT_MS
		});
		const installation = await installAbsoluteExpoAndroidRelease({
			androidAdb: adb,
			config,
			forwardedPort: port,
			host,
			log: (line) => console.log(line)
		});
		const { serial } = installation;
		const launch = () => {
			command(adb, '-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`);
			command(adb, '-s', serial, 'shell', 'am', 'force-stop', APP_ID);
			command(
				adb,
				'-s',
				serial,
				'shell',
				'monkey',
				'-p',
				APP_ID,
				'-c',
				'android.intent.category.LAUNCHER',
				'1'
			);
		};
		const report = async (label: ReleaseLabel, after = 0) =>
			waitFor(
				() =>
					reports
						.slice(after)
						.find((value) => value.release === label),
				`Expo OTA did not launch ${label}. Requests: ${JSON.stringify(Object.fromEntries(requestCounts))}`
			);
		const embedded = await report('embedded');
		expect(embedded).toMatchObject({
			authRetained: true,
			embedded: true,
			pending: 1
		});
		const installationId = await waitFor(
			() => updateInstallationId,
			'Expo OTA requests did not expose their SecureStore installation identity.'
		);

		const executable = await absoluteExpoExecutable(NATIVE_PROJECT);
		const runtimeVersion = resolveAbsoluteMobileUpdateRuntime(
			config,
			FIXTURE_ROOT
		).fingerprint;
		let lastCreatedAt = 0;
		const publish = async (
			label: ReleaseLabel,
			runtime = runtimeVersion,
			options: PublishOptions = {}
		) => {
			const exported = await runExpoExport(
				executable,
				label,
				runtime,
				origin
			);
			const createdAt = Math.max(Date.now(), lastCreatedAt + 1);
			let update:
				| Awaited<ReturnType<typeof buildAbsoluteMobileUpdate>>
				| undefined;
			for (let attempt = 0; attempt < 128; attempt += 1) {
				const candidate = await buildAbsoluteMobileUpdate({
					appId: APP_ID,
					bundleDirectory: exported.directory,
					channel: CHANNEL,
					classification: 'bug-fix',
					createdAt: new Date(createdAt + attempt),
					keyId: KEY_ID,
					outputDirectory: RELEASE_ROOT,
					privateKey: registrySigning.privateKey.export({
						format: 'pem',
						type: 'pkcs8'
					}),
					runtimeFingerprint: runtime
				});
				if (
					options.eligible === undefined ||
					isAbsoluteMobileUpdateRolloutMember({
						appId: APP_ID,
						channel: CHANNEL,
						installationId,
						releaseId: candidate.manifest.releaseId,
						rollout: options.rollout ?? 1
					}) === options.eligible
				) {
					update = candidate;
					break;
				}
			}
			if (!update)
				throw new Error(
					`Could not build an Expo update for the requested rollout cohort (${label}).`
				);
			lastCreatedAt = Date.parse(update.manifest.createdAt);
			await registry.publishUpdate({
				manifest: update.manifest,
				releaseDirectory: update.outputDirectory,
				rollout: options.rollout ?? 1
			});

			const { android } = exported.descriptor.platforms;
			if (!android)
				throw new Error('Expo Android export descriptor is missing.');

			return {
				expectedFiles: android.assets.length + 1,
				launchAssetPath: android.launchAsset.path,
				manifest: update.manifest,
				outputDirectory: update.outputDirectory
			};
		};
		const activate = async (
			label: ReleaseLabel,
			publication: Awaited<ReturnType<typeof publish>>,
			requireAllFiles = true
		) => {
			const before = reports.length;
			const filePrefix = `/__absolute/mobile/updates/${CHANNEL}/${publication.manifest.releaseId}/files/`;
			const launchAsset = `${filePrefix}${publication.launchAssetPath}`;
			launch();
			await waitFor(() => {
				const requests = requireAllFiles
					? [...requestCounts].reduce(
							(count, [path, fileRequests]) =>
								count +
								(path.startsWith(filePrefix)
									? fileRequests
									: 0),
							0
						)
					: (requestCounts.get(launchAsset) ?? 0);

				return requests >=
					(requireAllFiles ? publication.expectedFiles : 1)
					? true
					: undefined;
			}, `Expo OTA did not download ${label}.`);
			await Bun.sleep(5_000);
			launch();

			return report(label, before);
		};
		const activateCached = async (label: ReleaseLabel) => {
			const before = reports.length;
			const requestCount =
				requestCounts.get(
					`/__absolute/mobile/updates/${CHANNEL}/update.json`
				) ?? 0;
			launch();
			await waitFor(
				() =>
					(requestCounts.get(
						`/__absolute/mobile/updates/${CHANNEL}/update.json`
					) ?? 0) > requestCount
						? true
						: undefined,
				`Expo OTA did not stage cached ${label}.`
			);
			await Bun.sleep(5_000);
			launch();

			return report(label, before);
		};
		const releaseFileRequests = (releaseId: string) => {
			const prefix = `/__absolute/mobile/updates/${CHANNEL}/${releaseId}/files/`;

			return [...requestCounts].reduce(
				(count, [path, requests]) =>
					count + (path.startsWith(prefix) ? requests : 0),
				0
			);
		};
		const inspectRollout = async (target: MobileUpdateRegistry) => {
			if (!target.inspectUpdateRollout)
				throw new Error(
					'Expected Expo staged rollout inspection support.'
				);

			return target.inspectUpdateRollout({
				appId: APP_ID,
				channel: CHANNEL
			});
		};
		const waitForRollout = async (
			target: MobileUpdateRegistry,
			accept: (value: MobileUpdateRolloutReport) => boolean
		) => {
			const deadline = Date.now() + WAIT_TIMEOUT_MS;
			let last: MobileUpdateRolloutReport | null = null;
			while (Date.now() < deadline) {
				const value = await inspectRollout(target);
				last = value;
				if (value && accept(value)) return value;
				await Bun.sleep(250);
			}

			throw new Error(
				`Expo staged rollout did not reach the expected state. Last report: ${JSON.stringify(last)}. Health errors: ${JSON.stringify(healthErrors)}`
			);
		};

		const healthyPublication = await publish('healthy');
		const healthy = await activate('healthy', healthyPublication);
		expect(healthy).toMatchObject({ authRetained: true, pending: 0 });
		expect(healthy.embedded).toBe(false);
		expect(effects.size).toBe(1);

		await publish('bad-signature');
		fault = 'signature';
		const badStart = reports.length;
		launch();
		await report('healthy', badStart);
		await Bun.sleep(5_000);
		fault = undefined;
		expect(
			reports
				.slice(badStart)
				.some(({ release }) => release === 'bad-signature')
		).toBe(false);

		await publish('corrupt-asset');
		fault = 'asset';
		const corruptStart = reports.length;
		launch();
		const afterCorruptAsset = await report('healthy', corruptStart);
		expect(afterCorruptAsset.authRetained).toBe(true);
		await Bun.sleep(5_000);
		fault = undefined;
		expect(
			reports
				.slice(corruptStart)
				.some(({ release }) => release === 'corrupt-asset')
		).toBe(false);

		await publish('incompatible', 'f'.repeat(64));
		const incompatibleStart = reports.length;
		launch();
		await report('healthy', incompatibleStart);
		await Bun.sleep(5_000);
		expect(
			reports
				.slice(incompatibleStart)
				.some(({ release }) => release === 'incompatible')
		).toBe(false);
		await registry.promoteUpdate({
			appId: APP_ID,
			channel: CHANNEL,
			releaseId: healthyPublication.manifest.releaseId,
			rollout: 1
		});

		const interruptedPublication = await publish('interrupted');
		fault = 'delay-asset';
		const interruptedStart = reports.length;
		launch();
		await waitFor(
			() => (delayedAssetStarted ? true : undefined),
			'Expo OTA did not begin the interrupted asset download.'
		);
		command(adb, '-s', serial, 'shell', 'am', 'force-stop', APP_ID);
		fault = undefined;
		releaseDelayedAsset?.();
		await registry.promoteUpdate({
			appId: APP_ID,
			channel: CHANNEL,
			releaseId: healthyPublication.manifest.releaseId,
			rollout: 1
		});
		launch();
		await report('healthy', interruptedStart);
		expect(
			reports
				.slice(interruptedStart)
				.some(({ release }) => release === 'interrupted')
		).toBe(false);
		expect(interruptedPublication.expectedFiles).toBeGreaterThan(1);

		const brokenPublication = await publish('broken');
		const brokenLaunchAsset = `/__absolute/mobile/updates/${CHANNEL}/${brokenPublication.manifest.releaseId}/files/${brokenPublication.launchAssetPath}`;
		launch();
		await waitFor(
			() =>
				(requestCounts.get(brokenLaunchAsset) ?? 0) >= 1
					? true
					: undefined,
			'Expo OTA did not download the intentionally broken update.'
		);
		await Bun.sleep(5_000);
		await registry.rollbackUpdate({
			appId: APP_ID,
			channel: CHANNEL,
			releaseId: healthyPublication.manifest.releaseId
		});
		const brokenStart = reports.length;
		const recoveryRequestCount =
			requestCounts.get(
				`/__absolute/mobile/updates/${CHANNEL}/update.json`
			) ?? 0;
		launch();
		await waitFor(
			() =>
				(requestCounts.get(
					`/__absolute/mobile/updates/${CHANNEL}/update.json`
				) ?? 0) > recoveryRequestCount
					? true
					: undefined,
			'Expo error recovery did not request a server-known-good update.'
		);
		await Bun.sleep(7_000);
		launch();
		await report('healthy', brokenStart);
		expect(
			reports
				.slice(brokenStart)
				.some(({ release }) => release === 'broken')
		).toBe(false);

		const recoveryPublication = await publish('recovery');
		const recovered = await activate(
			'recovery',
			recoveryPublication,
			false
		);
		expect(recovered).toMatchObject({ authRetained: true, pending: 0 });
		await registry.rollbackUpdate({
			appId: APP_ID,
			channel: CHANNEL,
			releaseId: healthyPublication.manifest.releaseId
		});
		const previous = await activateCached('healthy');
		expect(previous).toMatchObject({ authRetained: true, pending: 0 });
		expect(previous.updateId).not.toBe(recovered.updateId);

		const manualRegistry = createRegistry(false);
		registry = manualRegistry;
		updateHandler = createHandler(registry);
		await manualRegistry.publishUpdate({
			manifest: healthyPublication.manifest,
			releaseDirectory: healthyPublication.outputDirectory,
			rollout: 1
		});

		const excludedPublication = await publish(
			'rollout-excluded',
			runtimeVersion,
			{ eligible: false, rollout: 0.5 }
		);
		const excluded = await inspectRollout(manualRegistry);
		if (!excluded)
			throw new Error('Expected an excluded Expo staged rollout.');
		const excludedRequests = releaseFileRequests(
			excludedPublication.manifest.releaseId
		);
		const excludedStart = reports.length;
		launch();
		await report('healthy', excludedStart);
		await Bun.sleep(1_000);
		expect(
			releaseFileRequests(excludedPublication.manifest.releaseId)
		).toBe(excludedRequests);

		const manualPublication = await publish(
			'rollout-manual',
			runtimeVersion,
			{ eligible: true, rollout: 0.5 }
		);
		const eligible = await inspectRollout(manualRegistry);
		if (!eligible)
			throw new Error('Expected an eligible Expo staged rollout.');
		expect(eligible.promotionId).not.toBe(excluded.promotionId);
		const manual = await activate(
			'rollout-manual',
			manualPublication,
			false
		);
		expect(manual).toMatchObject({ authRetained: true, pending: 0 });
		const manualHealth = await waitForRollout(
			manualRegistry,
			(value) =>
				value.promotionId === eligible.promotionId &&
				value.activated === 1 &&
				value.terminalReports === 1
		);
		expect(manualHealth.status).toBe('active');
		if (!manualRegistry.advanceUpdateRollout)
			throw new Error(
				'Expected Expo staged rollout advancement support.'
			);
		const concurrentAdvance = await Promise.all([
			manualRegistry.advanceUpdateRollout({
				appId: APP_ID,
				channel: CHANNEL,
				rollout: 1
			}),
			manualRegistry.advanceUpdateRollout({
				appId: APP_ID,
				channel: CHANNEL,
				rollout: 1
			})
		]);
		for (const advanced of concurrentAdvance)
			expect(advanced).toMatchObject({
				currentStage: 1,
				promotionId: eligible.promotionId,
				rollout: 1,
				status: 'complete'
			});
		const manualRestart = reports.length;
		launch();
		await report('rollout-manual', manualRestart);
		const afterManualRestart = await inspectRollout(manualRegistry);
		expect(afterManualRestart).toMatchObject({
			activated: 1,
			promotionId: eligible.promotionId,
			status: 'complete',
			terminalReports: 1
		});

		const operatorPublication = await publish(
			'rollout-operator',
			runtimeVersion,
			{ eligible: true, rollout: 0.5 }
		);
		if (
			!manualRegistry.pauseUpdateRollout ||
			!manualRegistry.resumeUpdateRollout ||
			!manualRegistry.cancelUpdateRollout
		)
			throw new Error('Expected Expo staged rollout operator controls.');
		await manualRegistry.pauseUpdateRollout({
			appId: APP_ID,
			channel: CHANNEL
		});
		const pausedRequests = releaseFileRequests(
			operatorPublication.manifest.releaseId
		);
		const pausedStart = reports.length;
		launch();
		await report('rollout-manual', pausedStart);
		expect(
			releaseFileRequests(operatorPublication.manifest.releaseId)
		).toBe(pausedRequests);
		await manualRegistry.resumeUpdateRollout({
			appId: APP_ID,
			channel: CHANNEL
		});
		await activate('rollout-operator', operatorPublication, false);
		await manualRegistry.cancelUpdateRollout({
			appId: APP_ID,
			channel: CHANNEL
		});
		await activateCached('rollout-manual');
		expect(await inspectRollout(manualRegistry)).toMatchObject({
			status: 'cancelled'
		});

		const brokenRollout = await publish('rollout-broken', runtimeVersion, {
			eligible: true,
			rollout: 0.5
		});
		const brokenRolloutRequests = releaseFileRequests(
			brokenRollout.manifest.releaseId
		);
		launch();
		await waitFor(
			() =>
				releaseFileRequests(brokenRollout.manifest.releaseId) >
				brokenRolloutRequests
					? true
					: undefined,
			'Expo staged rollout did not download its intentionally broken candidate.'
		);
		await Bun.sleep(5_000);
		const fleetRecoveryStart = reports.length;
		launch();
		await Bun.sleep(7_000);
		launch();
		await report('rollout-manual', fleetRecoveryStart);
		const fleetPaused = await waitForRollout(
			manualRegistry,
			(value) =>
				value.releaseId === brokenRollout.manifest.releaseId &&
				value.status === 'paused'
		);
		expect(fleetPaused).toMatchObject({
			failures: 1,
			pausedBy: 'fleet-health',
			rolledBack: 1,
			terminalReports: 1
		});
		const fleetPausedRequests = releaseFileRequests(
			brokenRollout.manifest.releaseId
		);
		const fleetPausedStart = reports.length;
		launch();
		await report('rollout-manual', fleetPausedStart);
		await Bun.sleep(1_000);
		expect(releaseFileRequests(brokenRollout.manifest.releaseId)).toBe(
			fleetPausedRequests
		);

		const automaticRegistry = createRegistry(true);
		registry = automaticRegistry;
		updateHandler = createHandler(registry);
		await automaticRegistry.publishUpdate({
			manifest: manualPublication.manifest,
			releaseDirectory: manualPublication.outputDirectory,
			rollout: 1
		});
		const automaticPublication = await publish(
			'rollout-automatic',
			runtimeVersion,
			{ eligible: true, rollout: 0.5 }
		);
		const automaticInitial = await inspectRollout(automaticRegistry);
		if (!automaticInitial)
			throw new Error('Expected an automatic Expo staged rollout.');
		const automatic = await activate(
			'rollout-automatic',
			automaticPublication,
			false
		);
		expect(automatic).toMatchObject({ authRetained: true, pending: 0 });
		const automaticComplete = await waitForRollout(
			automaticRegistry,
			(value) => value.status === 'complete'
		);
		expect(automaticComplete).toMatchObject({
			activated: 1,
			currentStage: 1,
			promotionId: automaticInitial.promotionId,
			terminalReports: 1
		});
		const automaticRestart = reports.length;
		launch();
		await report('rollout-automatic', automaticRestart);
		const automaticAfterRestart = await inspectRollout(automaticRegistry);
		expect(automaticAfterRestart).toMatchObject({
			activated: 1,
			promotionId: automaticInitial.promotionId,
			status: 'complete',
			terminalReports: 1
		});

		await registry.rollbackUpdate({ appId: APP_ID, channel: CHANNEL });
		const rollbackStart = reports.length;
		const rollbackRequestCount =
			requestCounts.get(
				`/__absolute/mobile/updates/${CHANNEL}/update.json`
			) ?? 0;
		launch();
		await waitFor(
			() =>
				(requestCounts.get(
					`/__absolute/mobile/updates/${CHANNEL}/update.json`
				) ?? 0) > rollbackRequestCount
					? true
					: undefined,
			'Expo OTA did not request the embedded rollback directive.'
		);
		const rolledBack = await report('embedded', rollbackStart);
		expect(rolledBack).toMatchObject({
			authRetained: true,
			embedded: true,
			pending: 0
		});
		expect(effects.size).toBe(1);

		expect(rolledBack.encryptedAtRest).toBe(true);
		await mkdir(ARTIFACT_ROOT, { recursive: true });
		await writeFile(
			resolve(ARTIFACT_ROOT, 'expo-android-update-conformance.json'),
			`${JSON.stringify(
				{
					auth: { credentialRetained: true },
					engine: 'expo',
					outcome: 'pass',
					platform: 'android',
					rollout: {
						automaticAdvanced:
							automaticComplete.status === 'complete',
						cancelledFallback: true,
						cohortExcluded:
							excluded.releaseId ===
							excludedPublication.manifest.releaseId,
						concurrentAdvance: concurrentAdvance.every(
							({ status }) => status === 'complete'
						),
						fleetPaused: fleetPaused.pausedBy === 'fleet-health',
						operatorPauseBlockedDownload: true,
						processRestartRetained:
							automaticAfterRestart?.status === 'complete',
						terminalReportsDeduplicated:
							automaticAfterRestart?.terminalReports === 1
					},
					sync: {
						deliveredExactlyOnce: effects.size === 1,
						encryptedAtRest: rolledBack.encryptedAtRest === true,
						pendingAfterActivation: healthy.pending
					},
					updates: {
						brokenUpdateRecovered: true,
						corruptAssetRejected: true,
						healthyActivated: true,
						incompatibleRuntimeRejected: true,
						interruptedDownloadRejected: true,
						recoveryActivated: true,
						rollbackToEmbedded: true,
						rollbackToPrevious: true,
						signatureRejected: true
					}
				},
				null,
				2
			)}\n`
		);
	}, 3_600_000);
});
