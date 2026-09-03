import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { normalizeAbsoluteMobileConfig } from '../../../src/mobile/config';
import { applyAbsoluteNativeObservability } from '../../../src/mobile/nativeObservability';

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots
			.splice(0)
			.map((root) => rm(root, { force: true, recursive: true }))
	);
});

const shared = {
	appId: 'com.example.absolute',
	appName: 'Absolute',
	server: { productionOrigin: 'https://example.com' }
} as const;

describe('native process observability projection', () => {
	test('idempotently provisions and removes the iOS MetricKit bridge', async () => {
		const root = await mkdtemp(
			join(tmpdir(), 'absolute-native-observability-')
		);
		roots.push(root);
		const delegate = join(root, 'mobile/ios/App/App/AppDelegate.swift');
		const nativeConfigPath = join(
			root,
			'mobile/ios/App/App/capacitor.config.json'
		);
		await Bun.write(
			delegate,
			`import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {}
`
		);
		await Bun.write(
			nativeConfigPath,
			`${JSON.stringify({ packageClassList: ['ThirdPartyPlugin'] })}\n`
		);
		const enabled = normalizeAbsoluteMobileConfig(
			{
				...shared,
				observability: { project: 'mobile' }
			},
			root
		);

		expect(
			(await applyAbsoluteNativeObservability(enabled, ['ios'])).changed
		).toBe(true);
		expect(
			(await applyAbsoluteNativeObservability(enabled, ['ios'])).changed
		).toBe(false);
		const source = await readFile(delegate, 'utf8');
		expect(source).toContain('import MetricKit');
		expect(source).toContain('MXMetricManagerSubscriber');
		expect(source).toContain('maximumReports = 8');
		expect(source).toContain('maximumReportBytes = 64 * 1024');
		expect(source).toContain('payload.crashDiagnostics');
		expect(source).toContain('call.getArray("ids", String.self)');
		const nativeConfig: unknown = JSON.parse(
			await readFile(nativeConfigPath, 'utf8')
		);
		expect(Reflect.get(nativeConfig as object, 'packageClassList')).toEqual(
			['ThirdPartyPlugin', 'AbsoluteMobileObservabilityPlugin']
		);

		const disabled = normalizeAbsoluteMobileConfig(shared, root);
		expect(
			(await applyAbsoluteNativeObservability(disabled, ['ios'])).changed
		).toBe(true);
		expect(await readFile(delegate, 'utf8')).not.toContain('MetricKit');
	});

	test('generates a bounded Android ApplicationExitInfo outbox', async () => {
		const root = await mkdtemp(
			join(tmpdir(), 'absolute-native-observability-')
		);
		roots.push(root);
		const activity = join(
			root,
			'mobile/android/app/src/main/java/com/example/absolute/MainActivity.java'
		);
		await Bun.write(
			activity,
			`package com.example.absolute;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {}
`
		);
		const enabled = normalizeAbsoluteMobileConfig(
			{
				...shared,
				observability: { project: 'mobile' }
			},
			root
		);

		expect(
			(await applyAbsoluteNativeObservability(enabled, ['android']))
				.changed
		).toBe(true);
		expect(
			(await applyAbsoluteNativeObservability(enabled, ['android']))
				.changed
		).toBe(false);
		const activitySource = await readFile(activity, 'utf8');
		expect(activitySource).toContain(
			'registerPlugin(AbsoluteMobileObservabilityPlugin.class)'
		);
		const plugin = join(
			root,
			'mobile/android/app/src/main/java/com/example/absolute/AbsoluteMobileObservabilityPlugin.java'
		);
		const source = await readFile(plugin, 'utf8');
		expect(source).toContain('getHistoricalProcessExitReasons');
		expect(source).toContain('ApplicationInfo.FLAG_DEBUGGABLE');
		expect(source).toContain('crashForTesting');
		expect(source).toContain('MAX_REPORTS = 8');
		expect(source).toContain('MAX_TRACE_BYTES = 32 * 1024');
		expect(source).toContain('REASON_CRASH_NATIVE');
		expect(source).toContain('android-tombstone-protobuf-base64');
		expect(source).not.toContain('readAllBytes');

		const disabled = normalizeAbsoluteMobileConfig(shared, root);
		await applyAbsoluteNativeObservability(disabled, ['android']);
		expect(existsSync(plugin)).toBe(false);
		expect(await readFile(activity, 'utf8')).not.toContain(
			'AbsoluteMobileObservabilityPlugin'
		);
	});

	test('injects an existing Kotlin lifecycle without duplicating it', async () => {
		const root = await mkdtemp(
			join(tmpdir(), 'absolute-native-observability-')
		);
		roots.push(root);
		const activity = join(
			root,
			'mobile/android/app/src/main/kotlin/com/example/absolute/MainActivity.kt'
		);
		await Bun.write(
			activity,
			`package com.example.absolute

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
    }
}
`
		);
		const enabled = normalizeAbsoluteMobileConfig(
			{
				...shared,
				observability: { project: 'mobile' }
			},
			root
		);
		await applyAbsoluteNativeObservability(enabled, ['android']);
		await applyAbsoluteNativeObservability(enabled, ['android']);
		const source = await readFile(activity, 'utf8');
		expect(source).toContain(
			'registerPlugin(AbsoluteMobileObservabilityPlugin::class.java)'
		);
		expect(source.match(/override fun onCreate/gu)).toHaveLength(1);
	});
});
