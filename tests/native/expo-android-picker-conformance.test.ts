import { afterAll, describe, expect, test } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { findFreePort } from '../../src/cli/utils';
import { normalizeAbsoluteMobileConfig } from '../../src/mobile/config';
import {
	startAbsoluteExpoDevSession,
	type AbsoluteExpoDevSession
} from '../../src/mobile/expoDevController';
import {
	detectAbsoluteMobileHost,
	inspectAbsoluteMobileToolchain
} from '../../src/mobile/emulatorDoctor';
import { writeAbsoluteExpoProject } from '../../src/mobile/expoProject';

const ENABLED = process.env.ABSOLUTE_TEST_NATIVE_EXPO_ANDROID_PICKER === '1';
const describeNative = ENABLED ? describe : describe.skip;
const PROJECT_ROOT = resolve(import.meta.dir, '..', '..');
const FIXTURE_ROOT = resolve(
	PROJECT_ROOT,
	'.absolutejs/expo-android-picker-conformance'
);
const NATIVE_PROJECT = resolve(FIXTURE_ROOT, 'native');
const ARTIFACT_ROOT = resolve(FIXTURE_ROOT, 'artifacts');
const APP_ID = 'com.absolutejs.expopickeracceptance';
const TEST_CAMERA_APP_ID = 'com.absolutejs.testcamera';
// A cold API 36 AVD can spend more than two minutes verifying a freshly
// installed Expo development client before React mounts for the first time.
const TIMEOUT_MS = 5 * 60_000;

type PickerReport = {
	cause?: string;
	code?: string;
	count?: number;
	kind?: 'direct' | 'direct-error' | 'mounted' | 'opening' | 'restored';
	message?: string;
	method?: string;
	plugin?: string;
	success?: boolean;
};

let expoSession: AbsoluteExpoDevSession | undefined;
let relay: ReturnType<typeof Bun.serve> | undefined;
let adbPath: string | undefined;
let androidSerial: string | undefined;
let androidLifecycleSettingManaged = false;

const command = (executable: string, ...args: string[]) => {
	let message = '';
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const result = Bun.spawnSync([executable, ...args], {
			stderr: 'pipe',
			stdout: 'pipe',
			timeout: 30_000
		});
		if (result.exitCode === 0) return result.stdout.toString().trim();
		message =
			result.stderr.toString().trim() || result.stdout.toString().trim();
	}
	throw new Error(`${executable} ${args.join(' ')} failed: ${message}`);
};

const readyAndroidSerials = (adb: string) =>
	command(adb, 'devices')
		.split(/\r?\n/u)
		.flatMap((line) => {
			const match = /^(\S+)\s+device$/u.exec(line.trim());

			return match?.[1] ? [match[1]] : [];
		});

const setAlwaysFinishActivities = (
	adb: string,
	serial: string,
	enabled: boolean
) => {
	const packagePath = command(
		adb,
		'-s',
		serial,
		'shell',
		'pm',
		'path',
		TEST_CAMERA_APP_ID
	)
		.split(/\r?\n/u)
		.find((line) => line.startsWith('package:'))
		?.slice('package:'.length);
	if (!packagePath)
		throw new Error('Android lifecycle driver package is unavailable.');
	command(
		adb,
		'-s',
		serial,
		'shell',
		`CLASSPATH=${packagePath}`,
		'app_process',
		'/system/bin',
		'com.absolutejs.testcamera.AbsoluteAlwaysFinish',
		enabled ? 'true' : 'false'
	);
	const activityManager = command(
		adb,
		'-s',
		serial,
		'shell',
		'dumpsys',
		'activity'
	);
	if (activityManager.includes('mAlwaysFinishActivities=true') !== enabled)
		throw new Error(
			`Android ActivityManager did not adopt always-finish=${enabled}.`
		);
};

const waitFor = async <T>(
	read: () => T | undefined,
	message: string,
	timeoutMs = TIMEOUT_MS
) => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const value = read();
		if (value !== undefined) return value;
		await Bun.sleep(250);
	}
	throw new Error(message);
};

const developmentUrl = (metroPort: number) =>
	`exp+${APP_ID.replaceAll('.', '-')}://expo-development-client/?url=${encodeURIComponent(`http://localhost:${metroPort}`)}`;

const openTestCamera = async (
	adb: string,
	serial: string,
	reports: PickerReport[],
	capture = true
) => {
	await waitFor(
		() =>
			reports.some(({ kind }) => kind === 'opening') ? true : undefined,
		'Expo picker operation did not begin.'
	);
	await waitFor(() => {
		const directError = reports.find(({ kind }) => kind === 'direct-error');
		if (directError)
			throw new Error(
				`Expo camera launch failed: ${directError.code ?? 'unknown'} ${directError.message ?? ''} ${directError.cause ?? ''}`.trim()
			);

		return command(
			adb,
			'-s',
			serial,
			'shell',
			'dumpsys',
			'activity',
			'activities'
		)
			.split(/\r?\n/u)
			.some(
				(line) =>
					line.includes('ResumedActivity') &&
					line.includes(TEST_CAMERA_APP_ID)
			)
			? true
			: undefined;
	}, 'Android camera resolver did not offer the deterministic test camera.');
	if (capture)
		command(
			adb,
			'-s',
			serial,
			'shell',
			'input',
			'keyevent',
			'KEYCODE_DPAD_CENTER'
		);
};

afterAll(async () => {
	if (adbPath && androidSerial && androidLifecycleSettingManaged) {
		try {
			setAlwaysFinishActivities(adbPath, androidSerial, false);
		} catch {
			// Best-effort cleanup must not hide the original conformance failure.
		}
	}
	if (adbPath && androidSerial) {
		Bun.spawnSync(
			[adbPath, '-s', androidSerial, 'uninstall', TEST_CAMERA_APP_ID],
			{ stderr: 'ignore', stdout: 'ignore', timeout: 10_000 }
		);
	}
	if (adbPath && androidSerial) {
		Bun.spawnSync(
			[
				adbPath,
				'-s',
				androidSerial,
				'shell',
				'am',
				'force-stop',
				'com.google.android.photopicker'
			],
			{ stderr: 'ignore', stdout: 'ignore', timeout: 10_000 }
		);
	}
	await expoSession?.close().catch(() => undefined);
	relay?.stop(true);
}, TIMEOUT_MS);

describeNative('real Expo Android picker restoration conformance', () => {
	test(
		'restores one selected photo after Android kills the background host process',
		async () => {
			const relayPort = await findFreePort();
			const metroPort = await findFreePort();
			const reports: PickerReport[] = [];
			let openRequested = false;
			relay = Bun.serve({
				port: relayPort,
				fetch: async (request) => {
					if (new URL(request.url).pathname === '/command') {
						const open = openRequested;
						openRequested = false;

						return Response.json({ open });
					}
					if (request.method === 'POST') {
						const report = (await request
							.json()
							.catch(() => ({}))) as PickerReport;
						reports.push(report);
						console.log(
							`[picker-report] ${JSON.stringify(report)}`
						);

						return new Response(null, { status: 204 });
					}

					return new Response('Not found', { status: 404 });
				}
			});
			await mkdir(ARTIFACT_ROOT, { recursive: true });
			await Promise.all([
				writeFile(
					resolve(FIXTURE_ROOT, 'package.json'),
					'{"dependencies":{},"private":true}\n'
				),
				writeFile(
					resolve(FIXTURE_ROOT, 'device-page.ts'),
					"import { camera } from '@absolutejs/devices'; void camera;\n"
				)
			]);
			const config = normalizeAbsoluteMobileConfig(
				{
					appId: APP_ID,
					appName: 'AbsoluteJS Expo Picker Acceptance',
					engine: 'expo',
					nativeProject: { directory: 'native' },
					platforms: ['android'],
					server: {
						productionOrigin: `http://localhost:${relayPort}`
					}
				},
				FIXTURE_ROOT
			);
			await writeAbsoluteExpoProject(config, {
				force: true,
				projectRoot: FIXTURE_ROOT
			});
			const fixturePackagePath = resolve(NATIVE_PROJECT, 'package.json');
			const fixturePackage = JSON.parse(
				await readFile(fixturePackagePath, 'utf8')
			) as {
				dependencies: Record<string, string>;
				expo?: {
					autolinking: {
						android: { buildFromSource: string[] };
					};
				};
				scripts: Record<string, string>;
			};
			fixturePackage.dependencies['expo-image-picker'] = '57.0.14';
			// Expo 57 normally links the picker from a prebuilt Maven artifact.
			// This disposable fixture builds it from source so its camera intent
			// can target the deterministic, test-only opaque camera activity.
			fixturePackage.expo = {
				autolinking: {
					android: { buildFromSource: ['expo-image-picker'] }
				}
			};
			fixturePackage.scripts.postinstall =
				'node scripts/patch-test-image-picker.cjs';
			await writeFile(
				fixturePackagePath,
				`${JSON.stringify(fixturePackage, null, 2)}\n`
			);
			await mkdir(resolve(NATIVE_PROJECT, 'scripts'), {
				recursive: true
			});
			await writeFile(
				resolve(NATIVE_PROJECT, 'scripts/patch-test-image-picker.cjs'),
				`const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const target = path.join(process.cwd(), 'node_modules/expo-image-picker/android/src/main/java/expo/modules/imagepicker/contracts/CameraContract.kt');
const original = 'Intent(input.options.nativeMediaTypes.toCameraIntentAction())';
const replacement = original + '.setPackage("com.absolutejs.testcamera")';
const source = readFileSync(target, 'utf8');
if (!source.includes(original)) throw new Error('Expo ImagePicker camera contract changed.');
if (!source.includes(replacement)) writeFileSync(target, source.replace(original, replacement));
`
			);
			await writeFile(
				resolve(NATIVE_PROJECT, 'plugins/withOpaqueTestCamera.js'),
				`const { withDangerousMod } = require('expo/config-plugins');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const source = [
  'package com.absolutejs.testcamera;',
  '',
  'import android.app.Activity;',
  'import android.content.Intent;',
  'import android.net.Uri;',
  'import android.os.Bundle;',
	  'import android.provider.MediaStore;',
	  'import android.util.Base64;',
	  'import android.view.KeyEvent;',
	  'import android.widget.Button;',
	  '',
	  'public class TestCameraActivity extends Activity {',
	  '  private Runnable capture;',
	  '  @Override public void onCreate(Bundle state) {',
  '    super.onCreate(state);',
	  '    if (getIntent().getBooleanExtra("absolutejs.setup", false)) { finish(); return; }',
  '    Button button = new Button(this);',
  '    button.setText("Capture test photo");',
  '    button.setContentDescription("Capture test photo");',
	  '    capture = () -> {',
  '      Uri output = getIntent().getParcelableExtra(MediaStore.EXTRA_OUTPUT);',
  '      try (java.io.OutputStream stream = getContentResolver().openOutputStream(output)) {',
  '        stream.write(Base64.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", Base64.DEFAULT));',
  '      } catch (java.io.IOException error) { setResult(RESULT_CANCELED); finish(); return; }',
  '      setResult(RESULT_OK, new Intent());',
  '      finish();',
	  '    };',
	  '    button.setOnClickListener(view -> capture.run());',
	  '    setContentView(button);',
	  '    button.requestFocus();',
	  '  }',
	  '  @Override public boolean onKeyUp(int keyCode, KeyEvent event) {',
	  '    if ((keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER) && capture != null) { capture.run(); return true; }',
	  '    return super.onKeyUp(keyCode, event);',
	  '  }',
	  '}',
  ''
].join('\\n');
const lifecycleDriver = [
  'package com.absolutejs.testcamera;',
  '',
  'public final class AbsoluteAlwaysFinish {',
  '  public static void main(String[] arguments) throws Exception {',
  '    Class<?> activityManager = Class.forName("android.app.ActivityManager");',
  '    java.lang.reflect.Method getService = activityManager.getDeclaredMethod("getService");',
  '    getService.setAccessible(true);',
  '    Object service = getService.invoke(null);',
  '    java.lang.reflect.Method setAlwaysFinish = service.getClass().getMethod("setAlwaysFinish", boolean.class);',
  '    setAlwaysFinish.invoke(service, Boolean.parseBoolean(arguments[0]));',
  '  }',
  '}',
  ''
].join('\\n');
const withOpaqueTestCamera = config => withDangerousMod(config, ['android', async value => {
    const android = value.modRequest.platformProjectRoot;
    const directory = path.join(android, 'testcamera/src/main/java/com/absolutejs/testcamera');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'TestCameraActivity.java'), source);
    await writeFile(path.join(directory, 'AbsoluteAlwaysFinish.java'), lifecycleDriver);
    await mkdir(path.join(android, 'testcamera/src/main'), { recursive: true });
    await writeFile(path.join(android, 'testcamera/src/main/AndroidManifest.xml'), '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><uses-permission android:name="android.permission.CAMERA"/><uses-feature android:name="android.hardware.camera" android:required="false"/><application android:label="AbsoluteJS test camera" android:theme="@android:style/Theme.Material.Light.NoActionBar"><activity android:name=".TestCameraActivity" android:label="AbsoluteJS test camera" android:exported="true"><intent-filter><action android:name="android.media.action.IMAGE_CAPTURE"/><category android:name="android.intent.category.DEFAULT"/></intent-filter></activity></application></manifest>\\n');
    await writeFile(path.join(android, 'testcamera/build.gradle'), 'apply plugin: "com.android.application"\\n\\nandroid {\\n  namespace "com.absolutejs.testcamera"\\n  compileSdk rootProject.ext.compileSdkVersion\\n  defaultConfig {\\n    applicationId "com.absolutejs.testcamera"\\n    minSdkVersion rootProject.ext.minSdkVersion\\n    targetSdkVersion rootProject.ext.targetSdkVersion\\n    versionCode 1\\n    versionName "1"\\n  }\\n}\\n');
    const settingsPath = path.join(android, 'settings.gradle');
    const settings = require('node:fs').readFileSync(settingsPath, 'utf8');
    await writeFile(settingsPath, settings + "\\ninclude ':testcamera'\\n");
    const rootBuildPath = path.join(android, 'build.gradle');
    const rootBuild = require('node:fs').readFileSync(rootBuildPath, 'utf8');
    // Ensure the test-only source patch reaches the APK with warm Gradle outputs.
    await writeFile(rootBuildPath, rootBuild + "\\nallprojects { candidate ->\\n  if (candidate.name in ['expo-image-picker', 'app']) candidate.tasks.configureEach {\\n    outputs.upToDateWhen { false }\\n    outputs.cacheIf { false }\\n  }\\n}\\n");
    const appBuildPath = path.join(android, 'app/build.gradle');
    const appBuild = require('node:fs').readFileSync(appBuildPath, 'utf8');
    await writeFile(appBuildPath, appBuild + "\\ntasks.matching { it.name == 'preDebugBuild' }.configureEach { dependsOn(':testcamera:assembleDebug') }\\n");
    const appManifestPath = path.join(android, 'app/src/main/AndroidManifest.xml');
    const appManifest = require('node:fs').readFileSync(appManifestPath, 'utf8');
    await writeFile(appManifestPath, appManifest.replace('<application', '<queries><intent><action android:name="android.media.action.IMAGE_CAPTURE"/><category android:name="android.intent.category.DEFAULT"/></intent></queries><application'));
    return value;
  }]);
module.exports = withOpaqueTestCamera;
`
			);
			const appConfigPath = resolve(NATIVE_PROJECT, 'app.json');
			const appConfig = JSON.parse(
				await readFile(appConfigPath, 'utf8')
			) as { expo: { plugins: unknown[] } };
			appConfig.expo.plugins.push('./plugins/withOpaqueTestCamera');
			await writeFile(
				appConfigPath,
				`${JSON.stringify(appConfig, null, 2)}\n`
			);
			await writeFile(
				resolve(NATIVE_PROJECT, 'app/index.tsx'),
				`import { camera, lifecycle } from '@absolutejs/devices';
import { useEffect } from 'react';
import { Text, View } from 'react-native';
const REPORT = 'http://localhost:${relayPort}/report';
const COMMAND = 'http://localhost:${relayPort}/command';
const report = (value: Record<string, unknown>) => fetch(REPORT, { body: JSON.stringify(value), headers: { 'content-type': 'application/json' }, method: 'POST' }).catch(() => undefined);
export default function Acceptance() {
  useEffect(() => {
    let active = true;
    let busy = false;
    let remove: (() => void | Promise<void>) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pick = async () => {
      await report({ kind: 'opening' });
      try {
        const selected = await camera.takePhoto();
        await report({ count: selected ? 1 : 0, kind: 'direct', success: true });
      } catch (error) {
        const failure = error as { code?: unknown; message?: unknown };
        await report({ cause: String((failure as { cause?: unknown })?.cause ?? ''), code: String(failure?.code ?? ''), kind: 'direct-error', message: String(failure?.message ?? error), success: false });
      }
    };
    const poll = async () => {
      const command = await fetch(COMMAND).then(value => value.json()).catch(() => ({ open: false }));
      if (command.open && !busy) {
        busy = true;
        await pick();
        busy = false;
      }
      if (active) timer = setTimeout(() => void poll(), 250);
    };
    void lifecycle.onRestoredOperation(operation => {
      const count = Array.isArray(operation.data) ? operation.data.length : operation.data ? 1 : 0;
      void report({ count, kind: 'restored', method: operation.method, plugin: operation.plugin, success: operation.success });
    }).then(value => { remove = value; });
    void report({ kind: 'mounted' });
    void poll();
    return () => { active = false; if (timer) clearTimeout(timer); void remove?.(); };
  }, []);
  return <View style={{ alignItems: 'center', flex: 1, justifyContent: 'center' }}><Text>AbsoluteJS native restoration gate</Text></View>;
}
`
			);
			const install = Bun.spawn(['bun', 'install'], {
				cwd: NATIVE_PROJECT,
				stderr: 'inherit',
				stdout: 'inherit'
			});
			if ((await install.exited) !== 0)
				throw new Error(
					'Expo picker acceptance dependency installation failed.'
				);

			const host = detectAbsoluteMobileHost();
			const checks = await inspectAbsoluteMobileToolchain({ host });
			const resolvedAdbPath = checks.find(
				({ id }) => id === 'android.adb'
			)?.path;
			if (!resolvedAdbPath)
				throw new Error('Expo picker acceptance requires Android adb.');
			adbPath = resolvedAdbPath;
			if (host === 'wsl' && adbPath.endsWith('.exe')) {
				// Windows adb can retain an orphaned pipe after a WSL caller exits.
				// Reset it before this gate owns Metro or an emulator session.
				Bun.spawnSync(
					[
						'powershell.exe',
						'-NoProfile',
						'-Command',
						'Get-Process adb -ErrorAction SilentlyContinue | Stop-Process -Force'
					],
					{ stderr: 'ignore', stdout: 'ignore', timeout: 30_000 }
				);
				command(adbPath, 'start-server');
			}
			const androidRoot = resolve(dirname(adbPath), '..');
			const buildId = Bun.hash(resolve(NATIVE_PROJECT))
				.toString(16)
				.slice(0, 10);
			const mirroredBuild = resolve(
				androidRoot,
				'..',
				'..',
				'ExpoBuilds',
				buildId
			);
			for (const serial of readyAndroidSerials(adbPath)) {
				Bun.spawnSync(
					[adbPath, '-s', serial, 'uninstall', TEST_CAMERA_APP_ID],
					{ stderr: 'ignore', stdout: 'ignore', timeout: 10_000 }
				);
				command(
					adbPath,
					'-s',
					serial,
					'reverse',
					`tcp:${relayPort}`,
					`tcp:${relayPort}`
				);
				command(
					adbPath,
					'-s',
					serial,
					'reverse',
					`tcp:${metroPort}`,
					`tcp:${metroPort}`
				);
				Bun.spawnSync(
					[
						adbPath,
						'-s',
						serial,
						'shell',
						'am',
						'force-stop',
						'com.google.android.apps.wellbeing'
					],
					{ stderr: 'ignore', stdout: 'ignore', timeout: 10_000 }
				);
				Bun.spawnSync(
					[
						adbPath,
						'-s',
						serial,
						'shell',
						'am',
						'force-stop',
						'com.google.android.photopicker'
					],
					{ stderr: 'ignore', stdout: 'ignore', timeout: 10_000 }
				);
				Bun.spawnSync([adbPath, '-s', serial, 'uninstall', APP_ID], {
					stderr: 'ignore',
					stdout: 'ignore',
					timeout: 10_000
				});
			}

			expoSession = await startAbsoluteExpoDevSession({
				androidOrigin: `http://localhost:${relayPort}`,
				config,
				host,
				metroPort,
				platforms: ['android'],
				log: (line) => console.log(line)
			});
			const readyAndroidSerial = await waitFor(
				() =>
					readyAndroidSerials(resolvedAdbPath).find((value) =>
						value.startsWith('emulator-')
					),
				'Expo picker acceptance did not find a ready Android emulator.'
			);
			androidSerial = readyAndroidSerial;
			const testCameraApk = resolve(
				mirroredBuild,
				'android/testcamera/build/outputs/apk/debug/testcamera-debug.apk'
			);
			command(
				adbPath,
				'-s',
				androidSerial,
				'install',
				'-r',
				command('wslpath', '-w', testCameraApk)
			);
			// Freshly installed packages are excluded from implicit-intent
			// resolution until their stopped state has been cleared once.
			command(
				adbPath,
				'-s',
				androidSerial,
				'shell',
				'am',
				'start',
				'-n',
				`${TEST_CAMERA_APP_ID}/.TestCameraActivity`,
				'--ez',
				'absolutejs.setup',
				'true'
			);
			command(
				adbPath,
				'-s',
				androidSerial,
				'shell',
				'pm',
				'grant',
				TEST_CAMERA_APP_ID,
				'android.permission.CAMERA'
			);
			setAlwaysFinishActivities(adbPath, androidSerial, false);
			androidLifecycleSettingManaged = true;
			command(
				adbPath,
				'-s',
				androidSerial,
				'shell',
				'pm',
				'grant',
				APP_ID,
				'android.permission.CAMERA'
			);
			command(
				adbPath,
				'-s',
				androidSerial,
				'shell',
				'am',
				'force-stop',
				APP_ID
			);
			reports.length = 0;
			command(
				adbPath,
				'-s',
				androidSerial,
				'reverse',
				`tcp:${relayPort}`,
				`tcp:${relayPort}`
			);
			command(
				adbPath,
				'-s',
				androidSerial,
				'reverse',
				`tcp:${metroPort}`,
				`tcp:${metroPort}`
			);
			command(
				adbPath,
				'-s',
				androidSerial,
				'shell',
				'am',
				'start',
				'-W',
				'-a',
				'android.intent.action.VIEW',
				'-d',
				developmentUrl(metroPort),
				APP_ID
			);
			await waitFor(
				() =>
					reports.some(({ kind }) => kind === 'mounted')
						? true
						: undefined,
				'Expo picker acceptance app did not mount.'
			);
			// Let the development client finish its cold-start main-thread work
			// before Android asks it to pause for an external camera activity.
			await Bun.sleep(10_000);
			openRequested = true;
			await openTestCamera(adbPath, androidSerial, reports);
			await waitFor(
				() =>
					reports.some(({ kind }) => kind === 'direct')
						? true
						: undefined,
				'Expo camera preference preflight did not complete.'
			);
			// Exercise the exact ActivityManager switch behind Android's "Don't keep
			// activities" developer option without brittle Settings UI automation.
			setAlwaysFinishActivities(adbPath, androidSerial, true);
			command(
				adbPath,
				'-s',
				androidSerial,
				'shell',
				'am',
				'force-stop',
				APP_ID
			);
			reports.length = 0;
			command(
				adbPath,
				'-s',
				androidSerial,
				'reverse',
				`tcp:${relayPort}`,
				`tcp:${relayPort}`
			);
			command(
				adbPath,
				'-s',
				androidSerial,
				'reverse',
				`tcp:${metroPort}`,
				`tcp:${metroPort}`
			);
			command(
				adbPath,
				'-s',
				androidSerial,
				'shell',
				'am',
				'start',
				'-W',
				'-a',
				'android.intent.action.VIEW',
				'-d',
				developmentUrl(metroPort),
				APP_ID
			);
			await waitFor(
				() =>
					reports.some(({ kind }) => kind === 'mounted')
						? true
						: undefined,
				'Expo picker acceptance app did not remount for process-death recovery.'
			);
			await Bun.sleep(10_000);

			openRequested = true;
			await openTestCamera(adbPath, androidSerial, reports, false);
			// "Don't keep activities" destroys the caller after the external camera
			// covers it. Kill the surviving background process to reproduce the
			// process-death path Android can take before the camera returns.
			await Bun.sleep(2_000);
			const appProcess = command(
				adbPath,
				'-s',
				androidSerial,
				'shell',
				'pidof',
				APP_ID
			)
				.split(/\s+/u)
				.at(0);
			if (!appProcess)
				throw new Error(
					'Expo picker acceptance could not resolve the host process.'
				);
			command(
				adbPath,
				'-s',
				androidSerial,
				'shell',
				'run-as',
				APP_ID,
				'kill',
				'-9',
				appProcess
			);
			command(
				adbPath,
				'-s',
				androidSerial,
				'shell',
				'input',
				'keyevent',
				'KEYCODE_DPAD_CENTER'
			);
			// Android may leave a killed background task dormant after the
			// external camera returns. Relaunch as a user would; Expo must then
			// expose the platform's pending result to the fresh JavaScript process.
			await waitFor(
				() =>
					command(
						resolvedAdbPath,
						'-s',
						readyAndroidSerial,
						'shell',
						'dumpsys',
						'activity',
						'activities'
					)
						.split(/\r?\n/u)
						.some(
							(line) =>
								line.includes('ResumedActivity') &&
								line.includes(TEST_CAMERA_APP_ID)
						)
						? undefined
						: true,
				'Android test camera did not return its result.'
			);
			command(
				adbPath,
				'-s',
				androidSerial,
				'shell',
				'am',
				'start',
				'-W',
				'-a',
				'android.intent.action.VIEW',
				'-d',
				developmentUrl(metroPort),
				APP_ID
			);

			const restored = await waitFor(
				() => reports.find(({ kind }) => kind === 'restored'),
				'Expo did not replay the pending Android image-picker result.'
			);
			expect(restored).toMatchObject({
				count: 1,
				method: 'takePhoto',
				plugin: 'expo-image-picker',
				success: true
			});
			await waitFor(
				() =>
					reports.filter(({ kind }) => kind === 'mounted').length >= 2
						? true
						: undefined,
				'Android did not recreate the Expo application activity.'
			);
			await Bun.sleep(1_000);
			expect(
				reports.filter(({ kind }) => kind === 'restored')
			).toHaveLength(1);
			expect(reports.some(({ kind }) => kind === 'direct')).toBe(false);
			expect(
				reports.every(
					(report) => !JSON.stringify(report).includes('file:')
				)
			).toBe(true);
			await writeFile(
				resolve(ARTIFACT_ROOT, 'expo-android-picker-conformance.json'),
				`${JSON.stringify(
					{
						backgroundProcessDeath: true,
						directPromiseReplayed: false,
						photoCount: restored.count,
						restoredExactlyOnce: true,
						sensitivePathReported: false
					},
					null,
					2
				)}\n`
			);
		},
		30 * 60_000
	);
});
