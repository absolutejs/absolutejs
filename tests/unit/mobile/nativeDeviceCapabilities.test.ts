import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeAbsoluteMobileConfig } from '../../../src/mobile/config';
import type { AbsoluteDeviceCapabilityPlan } from '../../../src/mobile/deviceCapabilities';
import { applyAbsoluteNativeDeviceCapabilities } from '../../../src/mobile/nativeDeviceCapabilities';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});

const cameraPlan: AbsoluteDeviceCapabilityPlan = {
	capabilities: ['camera', 'photos'],
	providers: {
		camera: {
			factory: 'createCapacitorCameraCapability',
			module: '@absolutejs/devices-capacitor/camera',
			native: {
				ios: {
					usageDescriptions: [
						'camera',
						'photo-library',
						'photo-library-add'
					]
				}
			},
			packages: ['@capacitor/camera@8.2.3']
		},
		photos: {
			factory: 'createCapacitorPhotosCapability',
			module: '@absolutejs/devices-capacitor/camera',
			native: {
				ios: {
					usageDescriptions: [
						'camera',
						'photo-library',
						'photo-library-add'
					]
				}
			},
			packages: ['@capacitor/camera@8.2.3']
		}
	},
	requiredPackages: ['@capacitor/camera@8.2.3']
};

const locationPlan: AbsoluteDeviceCapabilityPlan = {
	capabilities: ['location'],
	providers: {
		location: {
			factory: 'createCapacitorLocationCapability',
			module: '@absolutejs/devices-capacitor/location',
			native: {
				android: {
					permissions: [
						'android.permission.ACCESS_COARSE_LOCATION',
						'android.permission.ACCESS_FINE_LOCATION'
					]
				},
				ios: {
					usageDescriptions: [
						'location-always',
						'location-when-in-use'
					]
				}
			},
			packages: ['@capacitor/geolocation@8.2.2']
		}
	},
	requiredPackages: ['@capacitor/geolocation@8.2.2']
};

const documentsPlan: AbsoluteDeviceCapabilityPlan = {
	capabilities: ['documents'],
	providers: {
		documents: {
			factory: 'createCapacitorDocumentsCapability',
			module: '@absolutejs/devices-capacitor/documents',
			native: {
				ios: {
					privacyAccessedApis: {
						NSPrivacyAccessedAPICategoryFileTimestamp: ['C617.1']
					}
				}
			},
			packages: [
				'@capacitor/file-viewer@2.0.2',
				'@capacitor/filesystem@8.1.3',
				'@capacitor/share@8.0.1'
			]
		}
	},
	requiredPackages: [
		'@capacitor/file-viewer@2.0.2',
		'@capacitor/filesystem@8.1.3',
		'@capacitor/share@8.0.1'
	]
};

const localNotificationsPlan: AbsoluteDeviceCapabilityPlan = {
	capabilities: ['localNotifications'],
	providers: {
		localNotifications: {
			factory: 'createCapacitorLocalNotificationsCapability',
			module: '@absolutejs/devices-capacitor/local-notifications',
			native: {
				android: {
					permissions: ['android.permission.POST_NOTIFICATIONS']
				}
			},
			packages: ['@capacitor/local-notifications@8.2.1']
		}
	},
	requiredPackages: ['@capacitor/local-notifications@8.2.1']
};

const pushNotificationsPlan: AbsoluteDeviceCapabilityPlan = {
	capabilities: ['pushNotifications'],
	providers: {
		pushNotifications: {
			factory: 'createCapacitorPushNotificationsCapability',
			module: '@absolutejs/devices-capacitor/push-notifications',
			native: {
				android: {
					permissions: ['android.permission.POST_NOTIFICATIONS']
				},
				ios: { pushNotifications: true }
			},
			packages: ['@capacitor/push-notifications@8.1.2']
		}
	},
	requiredPackages: ['@capacitor/push-notifications@8.1.2']
};

const systemBarsPlan: AbsoluteDeviceCapabilityPlan = {
	capabilities: ['systemBars'],
	providers: {
		systemBars: {
			factory: 'createCapacitorSystemBarsCapability',
			module: '@absolutejs/devices-capacitor/system-bars',
			native: { ios: { systemBars: true } },
			packages: []
		}
	},
	requiredPackages: []
};

const iosProject = `// !$*UTF8*$!
{
objects = {
/* Begin PBXBuildFile section */
/* End PBXBuildFile section */
/* Begin PBXFileReference section */
/* End PBXFileReference section */
/* Begin PBXGroup section */
		504EC3061FED79650016851F /* App */ = {
			isa = PBXGroup;
			children = (
			);
			path = App;
		};
/* End PBXGroup section */
/* Begin PBXResourcesBuildPhase section */
		504EC3021FED79650016851F /* Resources */ = {
			isa = PBXResourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
			);
		};
/* End PBXResourcesBuildPhase section */
};
}
`;

describe('native device capability projection', () => {
	test('projects the modern iOS system-bars controller setting idempotently', async () => {
		const root = await mkdtemp(
			join(tmpdir(), 'absolute-native-system-bars-')
		);
		temporaryDirectories.push(root);
		const ios = join(root, 'mobile/ios/App/App');
		await mkdir(ios, { recursive: true });
		await writeFile(
			join(ios, 'Info.plist'),
			'<plist>\n<dict>\n</dict>\n</plist>\n'
		);
		const config = normalizeAbsoluteMobileConfig(
			{
				appId: 'com.example.systemui',
				appName: 'System UI',
				platforms: ['ios'],
				server: { productionOrigin: 'https://api.example.com' }
			},
			root
		);

		const first = await applyAbsoluteNativeDeviceCapabilities(
			root,
			config,
			['ios'],
			systemBarsPlan
		);
		const second = await applyAbsoluteNativeDeviceCapabilities(
			root,
			config,
			['ios'],
			systemBarsPlan
		);
		const info = await readFile(join(ios, 'Info.plist'), 'utf8');

		expect(first.changed).toEqual(['ios']);
		expect(second.changed).toEqual([]);
		expect(info).toContain(
			'<key>UIViewControllerBasedStatusBarAppearance</key>\n\t<true/>'
		);
	});

	test('rejects an incompatible user-owned iOS status-bar setting', async () => {
		const root = await mkdtemp(
			join(tmpdir(), 'absolute-native-system-bars-custom-')
		);
		temporaryDirectories.push(root);
		const ios = join(root, 'mobile/ios/App/App');
		await mkdir(ios, { recursive: true });
		await writeFile(
			join(ios, 'Info.plist'),
			'<plist>\n<dict>\n\t<key>UIViewControllerBasedStatusBarAppearance</key>\n\t<false/>\n</dict>\n</plist>\n'
		);
		const config = normalizeAbsoluteMobileConfig(
			{
				appId: 'com.example.systemui',
				appName: 'System UI',
				platforms: ['ios'],
				server: { productionOrigin: 'https://api.example.com' }
			},
			root
		);

		await expect(
			applyAbsoluteNativeDeviceCapabilities(
				root,
				config,
				['ios'],
				systemBarsPlan
			)
		).rejects.toThrow('UIViewControllerBasedStatusBarAppearance');
	});
	test('provisions native push plumbing and validates the Firebase application identity', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-native-push-'));
		temporaryDirectories.push(root);
		const ios = join(root, 'mobile/ios/App/App');
		const android = join(root, 'mobile/android/app/src/main');
		await Promise.all([
			mkdir(ios, { recursive: true }),
			mkdir(android, { recursive: true })
		]);
		await Promise.all([
			writeFile(
				join(ios, 'Info.plist'),
				'<plist>\n<dict>\n</dict>\n</plist>\n'
			),
			writeFile(
				join(ios, 'AppDelegate.swift'),
				'import UIKit\nimport Capacitor\nclass AppDelegate {\n}\n'
			),
			writeFile(
				join(ios, 'AbsoluteJS.entitlements'),
				'<plist>\n<dict>\n</dict>\n</plist>\n'
			),
			writeFile(
				join(android, 'AndroidManifest.xml'),
				'<manifest>\n    <application />\n</manifest>\n'
			),
			writeFile(
				join(root, 'google-services.json'),
				JSON.stringify({
					client: [
						{
							client_info: {
								android_client_info: {
									package_name: 'com.example.push'
								}
							}
						}
					]
				})
			)
		]);
		const config = normalizeAbsoluteMobileConfig(
			{
				appId: 'com.example.push',
				appName: 'Push',
				server: { productionOrigin: 'https://api.example.com' }
			},
			root
		);

		const first = await applyAbsoluteNativeDeviceCapabilities(
			root,
			config,
			config.platforms,
			pushNotificationsPlan
		);
		const second = await applyAbsoluteNativeDeviceCapabilities(
			root,
			config,
			config.platforms,
			pushNotificationsPlan
		);
		const entitlements = await readFile(
			join(ios, 'AbsoluteJS.entitlements'),
			'utf8'
		);
		const delegate = await readFile(join(ios, 'AppDelegate.swift'), 'utf8');
		const firebase = await readFile(
			join(root, 'mobile/android/app/google-services.json'),
			'utf8'
		);

		expect(first.changed).toEqual(['ios', 'android']);
		expect(second.changed).toEqual([]);
		expect(entitlements).toContain('<key>aps-environment</key>');
		expect(delegate).toContain(
			'.capacitorDidRegisterForRemoteNotifications'
		);
		expect(delegate).toContain(
			'.capacitorDidFailToRegisterForRemoteNotifications'
		);
		expect(JSON.parse(firebase).client).toHaveLength(1);
	});

	test('rejects a Firebase config for a different Android application before projection', async () => {
		const root = await mkdtemp(
			join(tmpdir(), 'absolute-native-push-wrong-')
		);
		temporaryDirectories.push(root);
		const android = join(root, 'mobile/android/app/src/main');
		await mkdir(android, { recursive: true });
		const manifest = '<manifest>\n    <application />\n</manifest>\n';
		await Promise.all([
			writeFile(join(android, 'AndroidManifest.xml'), manifest),
			writeFile(
				join(root, 'google-services.json'),
				JSON.stringify({
					client: [
						{
							client_info: {
								android_client_info: {
									package_name: 'com.example.other'
								}
							}
						}
					]
				})
			)
		]);
		const config = normalizeAbsoluteMobileConfig(
			{
				appId: 'com.example.push',
				appName: 'Push',
				platforms: ['android'],
				server: { productionOrigin: 'https://api.example.com' }
			},
			root
		);

		await expect(
			applyAbsoluteNativeDeviceCapabilities(
				root,
				config,
				config.platforms,
				pushNotificationsPlan
			)
		).rejects.toThrow('does not contain package com.example.push');
		expect(
			await readFile(join(android, 'AndroidManifest.xml'), 'utf8')
		).toBe(manifest);
	});
	test('generates idempotent iOS descriptions without unnecessary Android permissions', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-native-devices-'));
		temporaryDirectories.push(root);
		const ios = join(root, 'mobile/ios/App/App');
		const android = join(root, 'mobile/android/app/src/main');
		await Promise.all([
			mkdir(ios, { recursive: true }),
			mkdir(android, { recursive: true })
		]);
		await writeFile(
			join(ios, 'Info.plist'),
			'<plist>\n<dict>\n</dict>\n</plist>\n'
		);
		await writeFile(
			join(android, 'AndroidManifest.xml'),
			'<manifest>\n    <application />\n</manifest>\n'
		);
		const config = normalizeAbsoluteMobileConfig(
			{
				appId: 'com.example.camera',
				appName: 'Camera & Photos',
				server: { productionOrigin: 'https://api.example.com' }
			},
			root
		);

		const first = await applyAbsoluteNativeDeviceCapabilities(
			root,
			config,
			config.platforms,
			cameraPlan
		);
		const second = await applyAbsoluteNativeDeviceCapabilities(
			root,
			config,
			config.platforms,
			cameraPlan
		);
		const info = await readFile(join(ios, 'Info.plist'), 'utf8');
		const manifest = await readFile(
			join(android, 'AndroidManifest.xml'),
			'utf8'
		);

		expect(first.changed).toEqual(['ios']);
		expect(second.changed).toEqual([]);
		expect(info).toContain('<key>NSCameraUsageDescription</key>');
		expect(info).toContain('<key>NSPhotoLibraryUsageDescription</key>');
		expect(info).toContain('<key>NSPhotoLibraryAddUsageDescription</key>');
		expect(info).toContain('Camera &amp; Photos uses your camera');
		expect(manifest).not.toContain('android.permission.CAMERA');
		expect(manifest).not.toContain(
			'android.permission.READ_EXTERNAL_STORAGE'
		);
	});

	test('projects foreground location requirements idempotently on both platforms', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-native-location-'));
		temporaryDirectories.push(root);
		const ios = join(root, 'mobile/ios/App/App');
		const android = join(root, 'mobile/android/app/src/main');
		await Promise.all([
			mkdir(ios, { recursive: true }),
			mkdir(android, { recursive: true })
		]);
		await writeFile(
			join(ios, 'Info.plist'),
			'<plist>\n<dict>\n</dict>\n</plist>\n'
		);
		await writeFile(
			join(android, 'AndroidManifest.xml'),
			'<manifest>\n    <application />\n</manifest>\n'
		);
		const config = normalizeAbsoluteMobileConfig(
			{
				appId: 'com.example.location',
				appName: 'Location Example',
				server: { productionOrigin: 'https://api.example.com' }
			},
			root
		);

		const first = await applyAbsoluteNativeDeviceCapabilities(
			root,
			config,
			config.platforms,
			locationPlan
		);
		const second = await applyAbsoluteNativeDeviceCapabilities(
			root,
			config,
			config.platforms,
			locationPlan
		);
		const info = await readFile(join(ios, 'Info.plist'), 'utf8');
		const manifest = await readFile(
			join(android, 'AndroidManifest.xml'),
			'utf8'
		);

		expect(first.changed).toEqual(['ios', 'android']);
		expect(second.changed).toEqual([]);
		expect(info).toContain(
			'<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>'
		);
		expect(info).toContain(
			'<key>NSLocationWhenInUseUsageDescription</key>'
		);
		expect(manifest).toContain('android.permission.ACCESS_COARSE_LOCATION');
		expect(manifest).toContain('android.permission.ACCESS_FINE_LOCATION');
	});

	test('projects notification display permission without exact-alarm access', async () => {
		const root = await mkdtemp(
			join(tmpdir(), 'absolute-native-notifications-')
		);
		temporaryDirectories.push(root);
		const android = join(root, 'mobile/android/app/src/main');
		await mkdir(android, { recursive: true });
		await writeFile(
			join(android, 'AndroidManifest.xml'),
			'<manifest>\n    <application />\n</manifest>\n'
		);
		const config = normalizeAbsoluteMobileConfig(
			{
				appId: 'com.example.notifications',
				appName: 'Notifications Example',
				server: { productionOrigin: 'https://api.example.com' }
			},
			root
		);

		const first = await applyAbsoluteNativeDeviceCapabilities(
			root,
			config,
			['android'],
			localNotificationsPlan
		);
		const second = await applyAbsoluteNativeDeviceCapabilities(
			root,
			config,
			['android'],
			localNotificationsPlan
		);
		const manifest = await readFile(
			join(android, 'AndroidManifest.xml'),
			'utf8'
		);

		expect(first.changed).toEqual(['android']);
		expect(second.changed).toEqual([]);
		expect(manifest).toContain('android.permission.POST_NOTIFICATIONS');
		expect(manifest).not.toContain('SCHEDULE_EXACT_ALARM');
		expect(manifest).not.toContain('USE_EXACT_ALARM');
	});

	test('generates and targets the required iOS privacy manifest idempotently', async () => {
		const root = await mkdtemp(
			join(tmpdir(), 'absolute-native-documents-')
		);
		temporaryDirectories.push(root);
		const ios = join(root, 'mobile/ios/App/App');
		const project = join(root, 'mobile/ios/App/App.xcodeproj');
		await Promise.all([
			mkdir(ios, { recursive: true }),
			mkdir(project, { recursive: true })
		]);
		await writeFile(
			join(ios, 'Info.plist'),
			'<plist>\n<dict>\n</dict>\n</plist>\n'
		);
		await writeFile(join(project, 'project.pbxproj'), iosProject);
		const config = normalizeAbsoluteMobileConfig(
			{
				appId: 'com.example.documents',
				appName: 'Documents Example',
				server: { productionOrigin: 'https://api.example.com' }
			},
			root
		);

		const first = await applyAbsoluteNativeDeviceCapabilities(
			root,
			config,
			['ios'],
			documentsPlan
		);
		const second = await applyAbsoluteNativeDeviceCapabilities(
			root,
			config,
			['ios'],
			documentsPlan
		);
		const privacy = await readFile(
			join(ios, 'PrivacyInfo.xcprivacy'),
			'utf8'
		);
		const projected = await readFile(
			join(project, 'project.pbxproj'),
			'utf8'
		);

		expect(first.changed).toEqual(['ios']);
		expect(second.changed).toEqual([]);
		expect(privacy).toContain('NSPrivacyAccessedAPICategoryFileTimestamp');
		expect(privacy).toContain('<string>C617.1</string>');
		expect(
			projected.match(/PrivacyInfo\.xcprivacy in Resources/gu)
		).toHaveLength(2);
		expect(projected.match(/PrivacyInfo\.xcprivacy \*\//gu)).toHaveLength(
			3
		);
	});
});
