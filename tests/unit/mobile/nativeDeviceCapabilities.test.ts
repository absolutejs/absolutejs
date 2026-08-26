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
