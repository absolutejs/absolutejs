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
	dimensions?: string[];
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
		if (
			message.includes('device offline') &&
			args[0] === '-s' &&
			typeof args[1] === 'string'
		)
			Bun.spawnSync([executable, '-s', args[1], 'wait-for-device'], {
				stderr: 'ignore',
				stdout: 'ignore',
				timeout: 30_000
			});
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

const activityDestructionCount = (adb: string, serial: string) =>
	command(
		adb,
		'-s',
		serial,
		'logcat',
		'-d',
		'-s',
		'AbsoluteJS:D',
		'*:S'
	).split('Expo activity-result recovery activity destroyed').length - 1;

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

describeNative('real Expo Android picker recovery matrix', () => {
	test(
		'settles process-death success, cancellation, and stale results exactly once',
		async () => {
			const relayPort = await findFreePort();
			const metroPort = await findFreePort();
			const reports: PickerReport[] = [];
			let requestedOperation: 'pick' | 'takePhoto' | undefined;
			relay = Bun.serve({
				port: relayPort,
				fetch: async (request) => {
					if (new URL(request.url).pathname === '/command') {
						const operation = requestedOperation;
						requestedOperation = undefined;

						return Response.json({ operation });
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
const libraryTarget = path.join(process.cwd(), 'node_modules/expo-image-picker/android/src/main/java/expo/modules/imagepicker/contracts/ImageLibraryContract.kt');
let library = readFileSync(libraryTarget, 'utf8');
const replacements = [
  ['return PickMultipleVisualMedia(selectionLimit).createIntent(context, request)', 'return Intent("com.absolutejs.testcamera.PICK").setPackage("com.absolutejs.testcamera").putExtra("absolutejs.limit", selectionLimit)'],
  ['return PickMultipleVisualMedia().createIntent(context, request)', 'return Intent("com.absolutejs.testcamera.PICK").setPackage("com.absolutejs.testcamera").putExtra("absolutejs.limit", 3)'],
  ['return PickVisualMedia().createIntent(context, request)', 'return Intent("com.absolutejs.testcamera.PICK").setPackage("com.absolutejs.testcamera").putExtra("absolutejs.limit", 1)']
];
for (const [before, after] of replacements) {
  if (!library.includes(before) && !library.includes(after)) throw new Error('Expo ImagePicker library contract changed.');
  library = library.replaceAll(before, after);
}
writeFileSync(libraryTarget, library);
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
	  'import android.content.ClipData;',
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
	  '    final boolean picker = "com.absolutejs.testcamera.PICK".equals(getIntent().getAction());',
	  '    if (!picker) {',
	  '      Uri output = getIntent().getParcelableExtra(MediaStore.EXTRA_OUTPUT);',
	  '      try (java.io.OutputStream stream = getContentResolver().openOutputStream(output)) {',
	  '        stream.write(Base64.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", Base64.DEFAULT));',
	  '      }',
	  '      catch (java.io.IOException error) { setResult(RESULT_CANCELED); finish(); return; }',
	  '    }',
	  '    capture = () -> {',
	  '      if (picker) {',
	  '        int limit = Math.max(1, Math.min(3, getIntent().getIntExtra("absolutejs.limit", 1)));',
	  '        Intent result = new Intent().addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);',
	  '        Uri first = Uri.parse("content://com.absolutejs.testcamera.photos/first.png");',
	  '        result.setData(first);',
	  '        ClipData selected = ClipData.newUri(getContentResolver(), "AbsoluteJS test photo", first);',
	  '        for (int index = 1; index < limit; index++) selected.addItem(new ClipData.Item(Uri.parse("content://com.absolutejs.testcamera.photos/photo-" + index + ".png")));',
	  '        result.setClipData(selected);',
	  '        setResult(RESULT_OK, result);',
	  '        finish();',
	  '        return;',
	  '      }',
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
const photoProvider = [
  'package com.absolutejs.testcamera;',
  '',
  'import android.content.ContentProvider;',
  'import android.content.ContentValues;',
  'import android.database.Cursor;',
  'import android.database.MatrixCursor;',
  'import android.net.Uri;',
  'import android.os.ParcelFileDescriptor;',
  'import android.provider.OpenableColumns;',
  'import android.util.Base64;',
  'import java.io.File;',
  'import java.io.FileNotFoundException;',
  'import java.io.FileOutputStream;',
  '',
  'public class TestPhotoProvider extends ContentProvider {',
  '  private File file(Uri uri) { return new File(getContext().getCacheDir(), uri.getLastPathSegment()); }',
  '  @Override public boolean onCreate() { return true; }',
  '  @Override public String getType(Uri uri) { return "image/png"; }',
  '  @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {',
  '    File target = file(uri);',
  '    if (!target.exists()) try (FileOutputStream stream = new FileOutputStream(target)) { stream.write(Base64.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", Base64.DEFAULT)); } catch (java.io.IOException error) { throw new FileNotFoundException(error.getMessage()); }',
  '    return ParcelFileDescriptor.open(target, ParcelFileDescriptor.MODE_READ_ONLY);',
  '  }',
  '  @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String order) {',
  '    String[] columns = projection == null ? new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE } : projection;',
  '    MatrixCursor cursor = new MatrixCursor(columns);',
  '    Object[] values = new Object[columns.length];',
  '    for (int index = 0; index < columns.length; index++) { if (OpenableColumns.DISPLAY_NAME.equals(columns[index])) values[index] = uri.getLastPathSegment(); else if (OpenableColumns.SIZE.equals(columns[index])) values[index] = 68L; }',
  '    cursor.addRow(values);',
  '    return cursor;',
  '  }',
  '  @Override public int delete(Uri uri, String selection, String[] args) { return 0; }',
  '  @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }',
  '  @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { return 0; }',
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
    await writeFile(path.join(directory, 'TestPhotoProvider.java'), photoProvider);
    await writeFile(path.join(directory, 'AbsoluteAlwaysFinish.java'), lifecycleDriver);
    await mkdir(path.join(android, 'testcamera/src/main'), { recursive: true });
    // The exported provider contains only generated opaque 1x1 fixtures. This
    // removes transient URI-grant timing from the lifecycle test itself.
    await writeFile(path.join(android, 'testcamera/src/main/AndroidManifest.xml'), '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><uses-permission android:name="android.permission.CAMERA"/><uses-feature android:name="android.hardware.camera" android:required="false"/><application android:label="AbsoluteJS test picker" android:theme="@android:style/Theme.Material.Light.NoActionBar"><provider android:name=".TestPhotoProvider" android:authorities="com.absolutejs.testcamera.photos" android:exported="true" android:grantUriPermissions="true"/><activity android:name=".TestCameraActivity" android:label="AbsoluteJS test picker" android:exported="true"><intent-filter><action android:name="android.media.action.IMAGE_CAPTURE"/><category android:name="android.intent.category.DEFAULT"/></intent-filter><intent-filter><action android:name="com.absolutejs.testcamera.PICK"/><category android:name="android.intent.category.DEFAULT"/></intent-filter></activity></application></manifest>\\n');
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
				`import { camera, lifecycle, photos } from '@absolutejs/devices';
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
    const pick = async (operation: 'pick' | 'takePhoto') => {
      await report({ kind: 'opening', method: operation });
      try {
        const selected = operation === 'pick' ? await photos.pick({ limit: 2 }) : await camera.takePhoto();
        const values = Array.isArray(selected) ? selected : [selected];
        await report({ count: values.length, dimensions: values.map(value => String(value.width) + 'x' + String(value.height)), kind: 'direct', method: operation, success: true });
      } catch (error) {
        const failure = error as { code?: unknown; message?: unknown };
        await report({ cause: String((failure as { cause?: unknown })?.cause ?? ''), code: String(failure?.code ?? ''), kind: 'direct-error', message: String(failure?.message ?? error), success: false });
      }
    };
    const poll = async () => {
      const command = await fetch(COMMAND).then(value => value.json()).catch(() => ({ operation: undefined }));
      if ((command.operation === 'pick' || command.operation === 'takePhoto') && !busy) {
        busy = true;
        await pick(command.operation);
        busy = false;
      }
      if (active) timer = setTimeout(() => void poll(), 250);
    };
    void lifecycle.onRestoredOperation(operation => {
      const values = Array.isArray(operation.data) ? operation.data : operation.data ? [operation.data] : [];
      const error = operation.error as { code?: unknown; message?: unknown } | undefined;
      void report({ code: error?.code, count: values.length, dimensions: values.map(value => String((value as { width?: unknown }).width) + 'x' + String((value as { height?: unknown }).height)), kind: 'restored', message: error?.message, method: operation.method, plugin: operation.plugin, success: operation.success });
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
			requestedOperation = 'takePhoto';
			await openTestCamera(adbPath, androidSerial, reports);
			await waitFor(
				() =>
					reports.some(({ kind }) => kind === 'direct')
						? true
						: undefined,
				'Expo camera preference preflight did not complete.'
			);
			// Start the process-death case from a clean application runtime.
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

			requestedOperation = 'takePhoto';
			await openTestCamera(adbPath, androidSerial, reports, false);
			const destructionCount = activityDestructionCount(
				adbPath,
				androidSerial
			);
			setAlwaysFinishActivities(adbPath, androidSerial, true);
			// Do not kill until Android has completed destruction of the paused
			// caller. Expo persists its activity-result registry during onDestroy.
			await waitFor(
				() =>
					activityDestructionCount(
						resolvedAdbPath,
						readyAndroidSerial
					) > destructionCount
						? true
						: undefined,
				'Android did not finish destroying the picker caller Activity.'
			);
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
			await waitFor(() => {
				const current = Bun.spawnSync(
					[
						resolvedAdbPath,
						'-s',
						readyAndroidSerial,
						'shell',
						'pidof',
						APP_ID
					],
					{ stderr: 'ignore', stdout: 'pipe', timeout: 10_000 }
				)
					.stdout.toString()
					.trim();

				return current !== appProcess ? true : undefined;
			}, 'Android ActivityManager did not terminate the background host process.');
			// The old caller is already destroyed and its registry is durable. Keep
			// the fresh result-receiving Activity alive when the picker returns.
			setAlwaysFinishActivities(adbPath, androidSerial, false);
			// Let ActivityManager observe the dead application binder before the
			// external activity returns into the retained task record.
			await Bun.sleep(1_000);
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

			const startFreshRuntime = async (message: string) => {
				command(
					resolvedAdbPath,
					'-s',
					readyAndroidSerial,
					'shell',
					'am',
					'force-stop',
					APP_ID
				);
				reports.length = 0;
				command(
					resolvedAdbPath,
					'-s',
					readyAndroidSerial,
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
					message
				);
				await Bun.sleep(2_000);
			};
			const finishAfterProcessDeath = async (
				operation: 'pick' | 'takePhoto',
				key: 'KEYCODE_BACK' | 'KEYCODE_DPAD_CENTER'
			) => {
				requestedOperation = operation;
				await openTestCamera(
					resolvedAdbPath,
					readyAndroidSerial,
					reports,
					false
				);
				const recoveryDestructionCount = activityDestructionCount(
					resolvedAdbPath,
					readyAndroidSerial
				);
				setAlwaysFinishActivities(
					resolvedAdbPath,
					readyAndroidSerial,
					true
				);
				await waitFor(
					() =>
						activityDestructionCount(
							resolvedAdbPath,
							readyAndroidSerial
						) > recoveryDestructionCount
							? true
							: undefined,
					'Android did not finish destroying the picker caller Activity.'
				);
				const process = command(
					resolvedAdbPath,
					'-s',
					readyAndroidSerial,
					'shell',
					'pidof',
					APP_ID
				)
					.split(/\s+/u)
					.at(0);
				if (!process)
					throw new Error(
						'Expo picker matrix could not resolve the host process.'
					);
				command(
					resolvedAdbPath,
					'-s',
					readyAndroidSerial,
					'shell',
					'run-as',
					APP_ID,
					'kill',
					'-9',
					process
				);
				await waitFor(() => {
					const current = Bun.spawnSync(
						[
							resolvedAdbPath,
							'-s',
							readyAndroidSerial,
							'shell',
							'pidof',
							APP_ID
						],
						{ stderr: 'ignore', stdout: 'pipe', timeout: 10_000 }
					)
						.stdout.toString()
						.trim();

					return current !== process ? true : undefined;
				}, 'Android ActivityManager did not terminate the picker host process.');
				setAlwaysFinishActivities(
					resolvedAdbPath,
					readyAndroidSerial,
					false
				);
				await Bun.sleep(1_000);
				command(
					resolvedAdbPath,
					'-s',
					readyAndroidSerial,
					'shell',
					'input',
					'keyevent',
					key
				);
				await waitFor(() => {
					const activities = command(
						resolvedAdbPath,
						'-s',
						readyAndroidSerial,
						'shell',
						'dumpsys',
						'activity',
						'activities'
					);

					return activities
						.split(/\r?\n/u)
						.some(
							(line) =>
								line.includes('ResumedActivity') &&
								line.includes(TEST_CAMERA_APP_ID)
						)
						? undefined
						: true;
				}, 'Android deterministic picker did not close.');
				command(
					resolvedAdbPath,
					'-s',
					readyAndroidSerial,
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

				return waitFor(
					() =>
						reports.find(
							(report) =>
								report.kind === 'restored' &&
								report.method === operation
						),
					`Expo did not terminate the restored ${operation} operation.`
				);
			};

			// A consumed result must not return after a genuine cold restart.
			await startFreshRuntime(
				'Expo picker acceptance did not mount for stale-result validation.'
			);
			expect(reports.some(({ kind }) => kind === 'restored')).toBe(false);

			await startFreshRuntime(
				'Expo picker acceptance did not mount for multi-photo recovery.'
			);

			// The same native recovery path must retain a bounded multi-photo result.
			const restoredPick = await finishAfterProcessDeath(
				'pick',
				'KEYCODE_DPAD_CENTER'
			);
			expect(restoredPick).toMatchObject({
				count: 2,
				dimensions: ['1x1', '1x1'],
				method: 'pick',
				plugin: 'expo-image-picker',
				success: true
			});
			expect(
				reports.filter(
					({ kind, method }) =>
						kind === 'restored' && method === 'pick'
				)
			).toHaveLength(1);
			expect(
				reports.some(
					({ kind, method }) => kind === 'direct' && method === 'pick'
				)
			).toBe(false);

			await startFreshRuntime(
				'Expo picker acceptance did not mount for cancellation recovery.'
			);
			const restoredCancellation = await finishAfterProcessDeath(
				'pick',
				'KEYCODE_BACK'
			);
			expect(restoredCancellation).toMatchObject({
				code: 'cancelled',
				count: 0,
				method: 'pick',
				plugin: 'expo-image-picker',
				success: false
			});
			expect(
				reports.filter(
					({ kind, method }) =>
						kind === 'restored' && method === 'pick'
				)
			).toHaveLength(1);
			expect(
				reports.every(
					(report) => !JSON.stringify(report).includes('file:')
				)
			).toBe(true);
			await writeFile(
				resolve(ARTIFACT_ROOT, 'expo-android-picker-conformance.json'),
				`${JSON.stringify(
					{
						abandonedCancellationBounded: true,
						backgroundProcessDeath: true,
						directPromiseReplayed: false,
						multiPhotoCount: restoredPick.count,
						photoCount: restored.count,
						pickerCancellationCode: restoredCancellation.code,
						restoredExactlyOnce: true,
						sensitivePathReported: false,
						staleResultReplayed: false
					},
					null,
					2
				)}\n`
			);
		},
		30 * 60_000
	);
});
