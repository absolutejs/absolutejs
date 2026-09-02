import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, test } from 'bun:test';
import { normalizeAbsoluteMobileConfig } from '../../../src/mobile/config';
import { applyAbsoluteNativeUpdates } from '../../../src/mobile/nativeUpdates';

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots
			.splice(0)
			.map((root) => rm(root, { force: true, recursive: true }))
	);
});

describe('native mobile update recovery', () => {
	test('idempotently installs the iOS boot watchdog and recovery guard', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-native-update-'));
		roots.push(root);
		const delegate = join(root, 'mobile/ios/App/App/AppDelegate.swift');
		await Bun.write(
			delegate,
			`import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        return true
    }
}
`
		);
		await Bun.write(
			join(root, 'mobile/ios/App/App/capacitor.config.json'),
			`${JSON.stringify({ packageClassList: ['ThirdPartyPlugin'] })}\n`
		);
		const { publicKey } = generateKeyPairSync('ec', {
			namedCurve: 'prime256v1'
		});
		const config = normalizeAbsoluteMobileConfig(
			{
				appId: 'com.example.absolute',
				appName: 'Absolute',
				server: { productionOrigin: 'https://example.com' },
				updates: {
					publicKeys: {
						key: publicKey
							.export({ format: 'der', type: 'spki' })
							.toString('base64')
					}
				}
			},
			root
		);

		expect(
			(await applyAbsoluteNativeUpdates(config, ['ios'])).changed
		).toBe(true);
		expect(
			(await applyAbsoluteNativeUpdates(config, ['ios'])).changed
		).toBe(false);
		const source = await readFile(delegate, 'utf8');
		expect(source).toContain('NoCloud/ionic_built_snapshots');
		expect(source).toContain('UserDefaults.standard.removeObject');
		expect(source).toContain(
			'AbsoluteMobileUpdateWatchdogPlugin.recoverInterruptedBoot()'
		);
		expect(source).toContain('boot-timeout');
		expect(source).toContain('.milliseconds(20000)');
		expect(source).toContain('quarantinedReleases');
		const nativeConfig: unknown = JSON.parse(
			await readFile(
				join(root, 'mobile/ios/App/App/capacitor.config.json'),
				'utf8'
			)
		);
		expect(Reflect.get(nativeConfig as object, 'packageClassList')).toEqual(
			['ThirdPartyPlugin', 'AbsoluteMobileUpdateWatchdogPlugin']
		);
	});

	test('generates and removes an idempotent Android watchdog plugin', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-native-update-'));
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
		const { publicKey } = generateKeyPairSync('ec', {
			namedCurve: 'prime256v1'
		});
		const shared = {
			appId: 'com.example.absolute',
			appName: 'Absolute',
			server: { productionOrigin: 'https://example.com' }
		} as const;
		const config = normalizeAbsoluteMobileConfig(
			{
				...shared,
				updates: {
					bootTimeoutMs: 5000,
					publicKeys: {
						key: publicKey
							.export({ format: 'der', type: 'spki' })
							.toString('base64')
					}
				}
			},
			root
		);

		expect(
			(await applyAbsoluteNativeUpdates(config, ['android'])).changed
		).toBe(true);
		expect(
			(await applyAbsoluteNativeUpdates(config, ['android'])).changed
		).toBe(false);
		const source = await readFile(activity, 'utf8');
		expect(source).toContain('recoverInterruptedBoot(this)');
		expect(source).toContain(
			'registerPlugin(AbsoluteMobileUpdateWatchdogPlugin.class)'
		);
		const plugin = join(
			root,
			'mobile/android/app/src/main/java/com/example/absolute/AbsoluteMobileUpdateWatchdogPlugin.java'
		);
		const pluginSource = await readFile(plugin, 'utf8');
		expect(pluginSource).toContain('handler.postDelayed(deadline, 5000L)');
		expect(pluginSource).toContain('quarantinedReleases');
		expect(pluginSource).toContain('bridge.setServerBasePath');

		const disabled = normalizeAbsoluteMobileConfig(shared, root);
		expect(
			(await applyAbsoluteNativeUpdates(disabled, ['android'])).changed
		).toBe(true);
		expect(await readFile(activity, 'utf8')).not.toContain(
			'AbsoluteMobileUpdateWatchdogPlugin'
		);
		expect(existsSync(plugin)).toBe(false);
	});

	test('injects an existing Kotlin MainActivity without changing its lifecycle syntax', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-native-update-'));
		roots.push(root);
		const activity = join(
			root,
			'mobile/android/app/src/main/kotlin/com/example/kotlin/MainActivity.kt'
		);
		await Bun.write(
			activity,
			`package com.example.kotlin

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
    }
}
`
		);
		const { publicKey } = generateKeyPairSync('ec', {
			namedCurve: 'prime256v1'
		});
		const config = normalizeAbsoluteMobileConfig(
			{
				appId: 'com.example.kotlin',
				appName: 'Kotlin',
				server: { productionOrigin: 'https://example.com' },
				updates: {
					publicKeys: {
						key: publicKey
							.export({ format: 'der', type: 'spki' })
							.toString('base64')
					}
				}
			},
			root
		);

		expect(
			(await applyAbsoluteNativeUpdates(config, ['android'])).changed
		).toBe(true);
		expect(
			(await applyAbsoluteNativeUpdates(config, ['android'])).changed
		).toBe(false);
		const source = await readFile(activity, 'utf8');
		expect(source).toContain(
			'registerPlugin(AbsoluteMobileUpdateWatchdogPlugin::class.java)'
		);
		expect(source).not.toContain('public void onCreate');
		expect(source.match(/override fun onCreate/gu)).toHaveLength(1);
	});
});
