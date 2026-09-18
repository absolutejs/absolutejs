import { describe, expect, test } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { buildAndroidProofReleases } from '../helpers/buildAndroidProofReleases';
import { disconnectAndroidTestBackend } from '../helpers/androidOffline';
import { hasAndroidAnrDialog } from '../helpers/androidUiFailure';
import { readAndroidUiSnapshot } from '../helpers/androidUiSnapshot';
import { hasConnectedAndroidDefaultNetwork } from '../helpers/androidNetworkReady';
import { saveAndroidDiagnostic } from '../helpers/androidDiagnostic';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
	absoluteBundletoolPath,
	runAbsoluteAndroidReleaseAcceptance
} from '../../src/mobile/androidReleaseAcceptance';
import {
	createLocalHttpsEmulator,
	nativeCapture,
	pollNative
} from '../helpers/androidLocalHttps';

const root = resolve(import.meta.dir, '../..');
const enabled = process.env.ABSOLUTE_TEST_ANDROID_RELEASE_DATA === '1';
const suite = enabled ? describe : describe.skip;
const origin = 'https://localhost:48443';
const selectedEngine = process.env.ABSOLUTE_TEST_RELEASE_ENGINE;
if (
	enabled &&
	selectedEngine !== undefined &&
	selectedEngine !== 'capacitor' &&
	selectedEngine !== 'expo'
)
	throw new TypeError(
		'ABSOLUTE_TEST_RELEASE_ENGINE must be capacitor or expo.'
	);
const engines: readonly ('capacitor' | 'expo')[] =
	selectedEngine === 'capacitor' || selectedEngine === 'expo'
		? [selectedEngine]
		: ['capacitor', 'expo'];

suite('installed Android production server data and Sync', () => {
	test(
		`${engines.join(' and ')} render live typed props and recover a queued offline mutation`,
		async () => {
			const output = join(
				root,
				'.absolutejs/release-data-conformance',
				randomUUID()
			);
			await mkdir(output, { mode: 0o700, recursive: true });
			console.log(`[release-data] Evidence: ${output}`);
			const { env, releases } = await buildAndroidProofReleases(
				root,
				output,
				origin,
				undefined,
				engines
			);
			console.log(
				'[release-data] Selected builds complete; starting isolated emulator'
			);
			const emulator = await createLocalHttpsEmulator(root, output);
			const { device } = emulator;
			let trusted = false;
			try {
				for (const {
					engine,
					evidence,
					fixture,
					release,
					serverEntry,
					serverSha256
				} of releases) {
					expect(release.metadata.signed).toBe(true);
					expect(
						createHash('sha256')
							.update(await readFile(serverEntry))
							.digest('hex')
					).toBe(serverSha256);
					console.log(
						`[release-data] Installing ${engine} and checking offline shell`
					);
					const shell = await runAbsoluteAndroidReleaseAcceptance({
						adb: emulator.adb,
						artifactDirectory: join(evidence, 'shell'),
						bundletool: absoluteBundletoolPath(),
						java: emulator.java,
						release,
						serial: emulator.serial
					}).catch(async (error: unknown) => {
						// Offline bootstrap failures also need evidence before cleanup;
						// they occur before the live-data phase's diagnostic handler.
						await saveAndroidDiagnostic(
							join(evidence, 'shell-failed.xml'),
							() => readAndroidUiSnapshot(device)
						);
						await saveAndroidDiagnostic(
							join(evidence, 'shell-failed.png'),
							() =>
								nativeCapture(
									[
										emulator.adb,
										'-s',
										emulator.serial,
										'exec-out',
										'screencap',
										'-p'
									],
									root
								)
						);
						await saveAndroidDiagnostic(
							join(evidence, 'shell-failed-logcat.txt'),
							() => device('logcat', '-d', '-t', '2000')
						);
						throw error;
					});
					// Generated after building: the embedded JS cannot contain this value.
					const challenge = randomUUID();
					const backend = Bun.spawn(
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
								ABSOLUTE_TEST_RELEASE_KEY: emulator.key,
								ABSOLUTE_TEST_RELEASE_SERVER: serverEntry,
								NODE_ENV: 'production'
							},
							stderr: Bun.file(
								join(evidence, 'server.stderr.log')
							),
							stdin: 'ignore',
							stdout: Bun.file(
								join(evidence, 'server.stdout.log')
							)
						}
					);
					const facts = async () => {
						const response = await fetch(`${origin}/__proof`, {
							tls: {
								ca: await readFile(
									join(
										dirname(dirname(emulator.cert)),
										'rootCA.pem'
									),
									'utf8'
								)
							}
						});

						return (await response.json()) as {
							challenge: string;
							writes: number;
						};
					};
					const { appId } = release.metadata;
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
					let uiSample = 0;
					const ui = () => {
						const sample = uiSample++;

						return readAndroidUiSnapshot(device, {
							onAttempt: async ({
								attempt,
								output: diagnostic
							}) => {
								await writeFile(
									join(
										evidence,
										`ui-capture-${sample}-${attempt}.log`
									),
									diagnostic
								);
							}
						});
					};
					const capture = async (name: string) => {
						await writeFile(
							join(evidence, `${name}.png`),
							await nativeCapture(
								[
									emulator.adb,
									'-s',
									emulator.serial,
									'exec-out',
									'screencap',
									'-p'
								],
								root
							)
						);
						await writeFile(
							join(evidence, `${name}.xml`),
							await ui()
						);
					};
					try {
						await pollNative(
							async () => (await facts()).challenge === challenge,
							'synthetic HTTPS backend'
						);
						await device('reverse', 'tcp:48443', 'tcp:48443');
						// svc returns before reconnection finishes. Do not launch the TLS
						// check while the preceding offline-shell test is still restoring.
						await device('shell', 'svc', 'wifi', 'enable');
						await device('shell', 'svc', 'data', 'enable');
						await pollNative(async () => {
							const dump = await device(
								'shell',
								'dumpsys',
								'connectivity'
							);
							await writeFile(
								join(evidence, 'network-before-https.txt'),
								dump
							);

							return hasConnectedAndroidDefaultNetwork(dump);
						}, 'connected Android default network before HTTPS');
						if (!trusted) {
							await launch();
							await pollNative(
								async () =>
									(await ui()).includes('Unable to load'),
								'untrusted release TLS rejection'
							);
							expect(await ui()).not.toContain(challenge);
							await capture('untrusted');
							await device('shell', 'am', 'force-stop', appId);
							await emulator.trust();
							trusted = true;
						}
						await launch();
						console.log(
							`[release-data] Checking ${engine} live data`
						);
						await pollNative(async () => {
							const xml = await ui();

							return (
								xml.includes(`Server proof ${challenge}`) &&
								xml.includes('Connection online')
							);
						}, `${engine} live typed props and Sync connection`);
						await capture('online');
						console.log(
							`[release-data] Checking ${engine} offline queue`
						);
						expect((await facts()).writes).toBe(0);
						await disconnectAndroidTestBackend(device);
						await device('shell', 'svc', 'wifi', 'disable');
						await device('shell', 'svc', 'data', 'disable');
						await pollNative(
							async () =>
								!(await ui()).includes('Connection online'),
							'Sync disconnect'
						);
						const button =
							/<node\b[^>]*text="Queue proof"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/u.exec(
								await ui()
							);
						if (!button)
							throw new Error('Visible queue button not found');
						await device(
							'shell',
							'input',
							'tap',
							String(
								Math.round(
									(Number(button[1]) + Number(button[3])) / 2
								)
							),
							String(
								Math.round(
									(Number(button[2]) + Number(button[4])) / 2
								)
							)
						);
						await pollNative(
							async () => (await ui()).includes('Pending 1'),
							'offline mutation queued'
						);
						expect((await facts()).writes).toBe(0);
						await capture('offline-pending');
						await device('shell', 'svc', 'wifi', 'enable');
						await device('shell', 'svc', 'data', 'enable');
						await device('reverse', 'tcp:48443', 'tcp:48443');
						await pollNative(async () => {
							const xml = await ui();

							return (
								xml.includes('Pending 0') &&
								xml.includes('Committed 1') &&
								xml.includes(`Receipt ${challenge}`)
							);
						}, 'queued mutation acknowledged and rendered');
						expect((await facts()).writes).toBe(1);
						await capture('reconnected');
						await Bun.sleep(3000);
						expect((await facts()).writes).toBe(1);
						await writeFile(
							join(evidence, 'report.json'),
							JSON.stringify(
								{
									artifact: release.metadata,
									emulatorData: process.env
										.ABSOLUTE_TEST_RELEASE_REUSE_RUN
										? 'reused-test-avd'
										: 'fresh-test-avd',
									engine,
									format: 1,
									graphics:
										process.env.ABSOLUTE_TEST_RELEASE_GPU ??
										'avd-default',
									installedApkSigning: 'bundletool-test-key',
									limitations: [
										'No authenticated durability or process-death proof',
										'Not iOS evidence',
										'Not production DNS or public CA evidence'
									],
									serverData: {
										renderedChallenge: challenge,
										serverBundleSha256: serverSha256
									},
									shell,
									status: 'pass',
									sync: {
										offlinePending: 1,
										offlineServerWrites: 0,
										reconnectedPending: 0,
										serverWrites: 1
									},
									trust: 'isolated-emulator-system-ca'
								},
								null,
								2
							)
						);
						console.log(`[release-data] ${engine} passed`);
					} catch (error) {
						await capture('failed').catch(() => undefined);
						await saveAndroidDiagnostic(
							join(evidence, 'failed-logcat.txt'),
							() => device('logcat', '-d', '-t', '2500')
						);
						const failedUi = await readFile(
							join(evidence, 'failed.xml'),
							'utf8'
						).catch(() => '');
						const androidAnr = hasAndroidAnrDialog(failedUi);
						await writeFile(
							join(evidence, 'failure.json'),
							JSON.stringify({
								engine,
								reason: androidAnr
									? 'android-anr-dialog'
									: 'acceptance-failure',
								status: 'fail'
							})
						);
						if (androidAnr)
							throw new Error(
								'Android ANR dialog blocked release UI acceptance; this is not evidence of TLS rejection or a passing app.',
								{ cause: error }
							);

						throw error;
					} finally {
						backend.kill();
						await backend.exited;
						await device('shell', 'am', 'force-stop', appId);
					}
				}
			} finally {
				await emulator.close();
			}
		},
		90 * 60 * 1000
	);
});
