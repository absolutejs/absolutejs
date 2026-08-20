import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeAbsoluteMobileConfig } from '../../../src/mobile/config';
import { applyAbsoluteNativeDeepLinks } from '../../../src/mobile/nativeDeepLinks';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});

const androidManifest = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application>
        <activity android:name=".MainActivity">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`;

const iosInfo = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
\t<key>CFBundleName</key>
\t<string>App</string>
</dict>
</plist>
`;

const iosProject = `buildSettings = {
\tINFOPLIST_FILE = App/Info.plist;
};
buildSettings = {
\tINFOPLIST_FILE = App/Info.plist;
};
`;

const createNativeProject = async () => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-native-links-'));
	temporaryDirectories.push(root);
	const android = join(root, 'mobile/android/app/src/main');
	const iosApp = join(root, 'mobile/ios/App/App');
	const iosProjectDirectory = join(root, 'mobile/ios/App/App.xcodeproj');
	await Promise.all([
		mkdir(android, { recursive: true }),
		mkdir(iosApp, { recursive: true }),
		mkdir(iosProjectDirectory, { recursive: true })
	]);
	await Promise.all([
		writeFile(join(android, 'AndroidManifest.xml'), androidManifest),
		writeFile(join(iosApp, 'Info.plist'), iosInfo),
		writeFile(join(iosProjectDirectory, 'project.pbxproj'), iosProject)
	]);

	return root;
};

describe('native deep-link configuration', () => {
	test('generates idempotent Android and iOS declarations', async () => {
		const root = await createNativeProject();
		const config = normalizeAbsoluteMobileConfig(
			{
				appId: 'com.example.product',
				appName: 'Product',
				deepLinks: {
					hosts: ['links.example.com'],
					scheme: 'product'
				},
				server: { productionOrigin: 'https://api.example.com' }
			},
			root
		);

		const first = await applyAbsoluteNativeDeepLinks(config);
		const second = await applyAbsoluteNativeDeepLinks(config);
		const manifest = await readFile(
			join(root, 'mobile/android/app/src/main/AndroidManifest.xml'),
			'utf8'
		);
		const info = await readFile(
			join(root, 'mobile/ios/App/App/Info.plist'),
			'utf8'
		);
		const entitlements = await readFile(
			join(root, 'mobile/ios/App/AbsoluteJS.entitlements'),
			'utf8'
		);
		const project = await readFile(
			join(root, 'mobile/ios/App/App.xcodeproj/project.pbxproj'),
			'utf8'
		);

		expect(first.changed).toEqual(['ios', 'android']);
		expect(second.changed).toEqual([]);
		expect(manifest).toContain('android:autoVerify="true"');
		expect(manifest).toContain('android:host="api.example.com"');
		expect(manifest).toContain('android:host="links.example.com"');
		expect(manifest).toContain('android:scheme="product"');
		expect(info).toContain('<key>CFBundleURLTypes</key>');
		expect(info).toContain('<string>product</string>');
		expect(entitlements).toContain(
			'<string>applinks:links.example.com</string>'
		);
		expect(project.match(/CODE_SIGN_ENTITLEMENTS/g)).toHaveLength(2);
	});

	test('refuses to replace a custom iOS entitlements file', async () => {
		const root = await createNativeProject();
		const projectPath = join(
			root,
			'mobile/ios/App/App.xcodeproj/project.pbxproj'
		);
		await writeFile(
			projectPath,
			iosProject.replaceAll(
				'INFOPLIST_FILE',
				'CODE_SIGN_ENTITLEMENTS = App/Custom.entitlements;\n\tINFOPLIST_FILE'
			)
		);
		const config = normalizeAbsoluteMobileConfig(
			{
				appId: 'com.example.product',
				appName: 'Product',
				platforms: ['ios'],
				server: { productionOrigin: 'https://api.example.com' }
			},
			root
		);

		await expect(applyAbsoluteNativeDeepLinks(config)).rejects.toThrow(
			'already uses a different entitlements file'
		);
	});
});
