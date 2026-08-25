import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { normalizeAbsoluteMobileConfig } from '../../../src/mobile/config';
import { applyAbsoluteNativeBackgroundSync } from '../../../src/mobile/nativeBackgroundSync';

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true }))
	);
});

test('idempotently provisions iOS background processing for Auth + Sync apps', async () => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-background-sync-'));
	roots.push(root);
	const app = join(root, 'mobile/ios/App/App');
	await mkdir(app, { recursive: true });
	await Promise.all([
		writeFile(
			join(root, 'package.json'),
			JSON.stringify({
				dependencies: {
					'@absolutejs/auth': '0.70.0',
					'@absolutejs/sync': '2.23.0'
				}
			})
		),
		writeFile(
			join(app, 'Info.plist'),
			'<plist><dict>\n\t<key>UIBackgroundModes</key>\n\t<array>\n\t\t<string>audio</string>\n\t</array>\n</dict></plist>\n'
		),
		writeFile(
			join(app, 'AppDelegate.swift'),
			'import UIKit\nimport Capacitor\nclass AppDelegate {\n func application(_ app: UIApplication, didFinishLaunchingWithOptions options: [String: Any]?) -> Bool {\n  return true\n }\n}\n'
		)
	]);
	const config = normalizeAbsoluteMobileConfig(
		{
			appId: 'com.example.app',
			appName: 'Example',
			nativeProject: { directory: 'mobile' },
			platforms: ['ios'],
			server: { productionOrigin: 'https://app.example' }
		},
		root
	);
	expect(
		(await applyAbsoluteNativeBackgroundSync(root, config)).changed
	).toBe(true);
	expect(
		(await applyAbsoluteNativeBackgroundSync(root, config)).changed
	).toBe(false);
	const info = await readFile(join(app, 'Info.plist'), 'utf8');
	const delegate = await readFile(join(app, 'AppDelegate.swift'), 'utf8');
	expect(info).toContain('com.example.app.absolutejs.background-sync');
	expect(info).toContain('<string>processing</string>');
	expect(info).toContain('<string>audio</string>');
	expect(info.match(/<key>UIBackgroundModes<\/key>/g)).toHaveLength(1);
	expect(delegate).toContain('import AbsoluteSyncCapacitor');
	expect(delegate).toContain(
		'AbsoluteBackgroundSyncPlugin.registerBackgroundTask()'
	);
});
