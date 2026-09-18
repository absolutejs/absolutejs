import { describe, expect, test } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
	absoluteBundletoolPath,
	runAbsoluteAndroidReleaseAcceptance
} from '../../src/mobile/androidReleaseAcceptance';
import { buildAndroidProofReleases } from '../helpers/buildAndroidProofReleases';
import {
	createLocalHttpsEmulator,
	nativeCapture,
	pollNative
} from '../helpers/androidLocalHttps';
import { disconnectAndroidTestBackend } from '../helpers/androidOffline';
import { readAndroidUiSnapshot } from '../helpers/androidUiSnapshot';
import { hasConnectedAndroidDefaultNetwork } from '../helpers/androidNetworkReady';
import type { AuthenticatedProofRow } from '../helpers/authenticatedReleaseProofBackend';

const enabled = process.env.ABSOLUTE_TEST_ANDROID_AUTHENTICATED_RELEASE === '1';
const suite = enabled ? describe : describe.skip;
const selected = process.env.ABSOLUTE_TEST_RELEASE_ENGINE;
if (
	enabled &&
	selected !== undefined &&
	selected !== 'expo' &&
	selected !== 'capacitor'
)
	throw new Error('Invalid release engine');
const engines: readonly ('capacitor' | 'expo')[] =
	selected === 'expo' || selected === 'capacitor'
		? [selected]
		: ['capacitor', 'expo'];
const root = resolve(import.meta.dir, '../..');
const origin = 'https://localhost:48443';

suite('signed Android Auth and durable Sync', () => {
	test(
		'survives process death and isolates account outboxes in both engines',
		async () => {
			// Share the owned-AVD evidence parent so identity-checked reuse remains valid.
			const output = join(
				root,
				'.absolutejs/release-data-conformance',
				randomUUID()
			);
			await mkdir(output, { mode: 0o700, recursive: true });
			console.log(`[authenticated-release] Evidence: ${output}`);
			const { env, releases } = await buildAndroidProofReleases(
				root,
				output,
				origin,
				undefined,
				engines,
				'authenticated'
			);
			const emulator = await createLocalHttpsEmulator(root, output);
			const { device } = emulator;
			try {
				const ca = await readFile(
					join(dirname(dirname(emulator.cert)), 'rootCA.pem'),
					'utf8'
				);
				await emulator.trust();
				const browserFlags = join(output, 'chrome-command-line');
				await writeFile(
					browserFlags,
					'chrome --disable-fre --no-first-run --no-default-browser-check\n'
				);
				const browserFlagsPath =
					emulator.adb.endsWith('.exe') &&
					process.platform !== 'win32'
						? (
								await nativeCapture(
									['wslpath', '-w', browserFlags],
									root
								)
							)
								.toString()
								.trim()
						: browserFlags;
				await device(
					'push',
					browserFlagsPath,
					'/data/local/tmp/chrome-command-line'
				);
				await device('shell', 'am', 'force-stop', 'com.android.chrome');
				for (const {
					engine,
					release,
					fixture,
					evidence,
					serverEntry,
					serverSha256
				} of releases) {
					const phases: string[] = [];
					let phase = 'signed-offline-shell';
					let backend: ReturnType<typeof Bun.spawn> | undefined;
					const challenge = randomUUID();
					const { appId } = release.metadata;
					const ui = () => readAndroidUiSnapshot(device);
					const waitUi = (text: string) =>
						pollNative(
							async () => (await ui()).includes(text),
							text
						);
					const tap = async (label: string) => {
						await pollNative(async () => {
							const nodes =
								(await ui()).match(/<node\b[^>]*>/gu) ?? [];
							const node = nodes.find(
								(value) =>
									value.includes(`text="${label}"`) &&
									!value.includes('enabled="false"')
							);
							const bounds =
								node &&
								/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/u.exec(
									node
								);
							if (!bounds) return false;
							await device(
								'shell',
								'input',
								'tap',
								String(
									Math.round(
										(Number(bounds[1]) +
											Number(bounds[3])) /
											2
									)
								),
								String(
									Math.round(
										(Number(bounds[2]) +
											Number(bounds[4])) /
											2
									)
								)
							);

							return true;
						}, `synthetic ${label} button`);
					};
					const launch = async () => {
						await device('shell', 'am', 'force-stop', appId);
						await device(
							'shell',
							'input',
							'keyevent',
							'KEYCODE_WAKEUP'
						);
						await device('shell', 'wm', 'dismiss-keyguard');
						await device(
							'shell',
							'am',
							'start',
							'-W',
							'-n',
							`${appId}/.MainActivity`
						);
					};
					const online = async () => {
						await device('shell', 'svc', 'wifi', 'enable');
						await device('shell', 'svc', 'data', 'enable');
						await device('reverse', 'tcp:48443', 'tcp:48443');
						await pollNative(
							async () =>
								hasConnectedAndroidDefaultNetwork(
									await device(
										'shell',
										'dumpsys',
										'connectivity'
									)
								),
							'Android network connected'
						);
					};
					const offline = async () => {
						await disconnectAndroidTestBackend(device);
						await device('shell', 'svc', 'wifi', 'disable');
						await device('shell', 'svc', 'data', 'disable');
					};
					const facts = async () => {
						const response = await fetch(`${origin}/__proof`, {
							tls: { ca }
						});
						if (!response.ok)
							throw new Error('Synthetic facts unavailable');

						return (await response.json()) as {
							challenge: string;
							rows: AuthenticatedProofRow[];
							writes: number;
						};
					};
					const gate = async (state: 'open' | 'closed') => {
						const response = await fetch(
							`${origin}/__proof/sync-gate`,
							{
								body: state,
								headers: { 'x-proof-control': challenge },
								method: 'POST',
								tls: { ca }
							}
						);
						expect(response.ok).toBe(true);
					};
					const signIn = async (account: 'A' | 'B') => {
						await tap('Sign in');
						await tap(`Authorize account ${account}`);
						await waitUi(
							`Account account-${account.toLowerCase()}`
						);
					};
					const report = async (status: 'pass' | 'fail') =>
						writeFile(
							join(evidence, 'authenticated-report.json'),
							JSON.stringify(
								{
									artifact: release.metadata,
									engine,
									format: 1,
									installedApkSigning: 'bundletool-test-key',
									limitations: [
										'Not iOS evidence',
										'Not production DNS or public CA evidence',
										'Not a server-process-crash test'
									],
									phase,
									phases,
									serverBundleSha256: serverSha256,
									status,
									trust: 'isolated-emulator-system-ca',
									// Deliberately no raw UI, logcat, HTTP traffic, tokens or callbacks.
									...(status === 'pass'
										? {
												writes: {
													'account-a': 2,
													'account-b': 1
												}
											}
										: {})
								},
								null,
								2
							)
						);
					try {
						expect(release.metadata.signed).toBe(true);
						expect(
							createHash('sha256')
								.update(await readFile(serverEntry))
								.digest('hex')
						).toBe(serverSha256);
						await device('logcat', '-c');
						await runAbsoluteAndroidReleaseAcceptance({
							adb: emulator.adb,
							artifactDirectory: join(evidence, 'shell'),
							bundletool: absoluteBundletoolPath(),
							java: emulator.java,
							release,
							serial: emulator.serial
						});
						phases.push(phase);
						backend = Bun.spawn(
							[
								process.execPath,
								join(root, 'tests/helpers/serveReleaseProof.ts')
							],
							{
								cwd: fixture,
								env: {
									...env,
									ABSOLUTE_BUILD_DIR: '.absolutejs/build',
									ABSOLUTE_TEST_RELEASE_CERT: emulator.cert,
									ABSOLUTE_TEST_RELEASE_CHALLENGE: challenge,
									ABSOLUTE_TEST_RELEASE_DATABASE: join(
										evidence,
										'synthetic-server.sqlite'
									),
									ABSOLUTE_TEST_RELEASE_KEY: emulator.key,
									ABSOLUTE_TEST_RELEASE_SERVER: serverEntry,
									NODE_ENV: 'production'
								},
								stderr: 'ignore',
								stdin: 'ignore',
								stdout: 'ignore'
							}
						);
						await pollNative(
							async () => (await facts()).challenge === challenge,
							'synthetic backend'
						);
						phase = 'native-pkce-account-a';
						await online();
						await launch();
						await waitUi(`Server proof ${challenge}`);
						await signIn('A');
						await waitUi('Connection online');
						await waitUi('Persisted 0');
						phases.push(phase);
						phase = 'offline-persisted-mutation';
						await offline();
						await tap('Queue proof');
						await waitUi('Pending 1');
						await waitUi('Persisted 1');
						expect((await facts()).writes).toBe(0);
						phases.push(phase);
						phase = 'offline-process-death';
						await launch(); // Force-stop, then reopen; never pm clear/uninstall.
						await pollNative(async () => {
							const snapshot = await ui();

							return (
								snapshot.includes('Unable to load') ||
								(snapshot.includes('Account account-a') &&
									snapshot.includes('Persisted 1'))
							);
						}, 'offline restart fallback or restored durable account');
						expect((await facts()).writes).toBe(0);
						phases.push(phase);
						phase = 'restored-outbox-single-effect';
						await online();
						await launch();
						await waitUi(`Receipt account-a ${challenge}`);
						await waitUi('Pending 0');
						await waitUi('Persisted 0');
						expect((await facts()).writes).toBe(1);
						await offline();
						await online();
						await waitUi('Connection online');
						expect((await facts()).writes).toBe(1);
						phases.push(phase);
						phase = 'account-a-pending-before-switch';
						await gate('closed');
						await offline(); // Close existing sockets before restoring Auth only.
						await online();
						await tap('Queue proof');
						await waitUi('Persisted 1');
						expect((await facts()).writes).toBe(1);
						phases.push(phase);
						phase = 'account-b-isolation';
						await tap('Sign out');
						await waitUi('Account signed-out');
						await signIn('B');
						await waitUi('Persisted 0');
						await waitUi('Committed 0');
						expect(
							(await ui()).includes(
								`Receipt account-a ${challenge}`
							)
						).toBe(false);
						await gate('open');
						await waitUi('Connection online');
						expect((await facts()).writes).toBe(1);
						await tap('Queue proof');
						await waitUi(`Receipt account-b ${challenge}`);
						await waitUi('Persisted 0');
						expect((await facts()).writes).toBe(2);
						phases.push(phase);
						phase = 'account-a-outbox-restored-after-switch';
						await tap('Sign out');
						await waitUi('Account signed-out');
						await signIn('A');
						await waitUi('Committed 2');
						await waitUi('Persisted 0');
						expect(
							(await ui()).includes(
								`Receipt account-b ${challenge}`
							)
						).toBe(false);
						const result = await facts();
						expect(
							result.rows.filter(
								(row) => row.owner === 'account-a'
							)
						).toHaveLength(2);
						expect(
							result.rows.filter(
								(row) => row.owner === 'account-b'
							)
						).toHaveLength(1);
						expect(result.writes).toBe(3);
						phases.push(phase);
						await report('pass');
						console.log(`[authenticated-release] ${engine} passed`);
					} catch {
						await report('fail');
						throw new Error(
							`Authenticated ${engine} release failed at ${phase}; see the redacted phase report.`
						);
					} finally {
						await device('shell', 'am', 'force-stop', appId).catch(
							() => undefined
						);
						backend?.kill();
						if (backend) await backend.exited;
					}
				}
			} finally {
				await emulator.close();
			}
		},
		3 * 60 * 60 * 1000
	);
});
