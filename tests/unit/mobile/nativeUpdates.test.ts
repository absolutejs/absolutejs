import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
	test('idempotently clears only dangling iOS snapshot pointers', async () => {
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
	});
});
