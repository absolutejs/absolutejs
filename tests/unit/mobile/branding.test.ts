import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	ABSOLUTE_CAPACITOR_ASSETS_VERSION,
	absoluteExpoBrandingConfig,
	createAbsoluteMobileBrandingManifest,
	generateAbsoluteCapacitorBranding,
	inspectAbsoluteMobileBranding
} from '../../../src/mobile/branding';
import { normalizeAbsoluteMobileConfig } from '../../../src/mobile/config';
import { writeAbsoluteExpoProject } from '../../../src/mobile/expoProject';
import type { MobileConfig } from '../../../types/build';

const temporaryDirectories: string[] = [];
const FIXTURE_ICON = join(
	process.cwd(),
	'tests',
	'fixtures',
	'capacitor-android-release',
	'.absolutejs',
	'mobile',
	'android',
	'app',
	'src',
	'main',
	'res',
	'mipmap-xxxhdpi',
	'ic_launcher.png'
);

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});

const png = async (path: string, size = 1024) => {
	const output = await new Bun.Image(FIXTURE_ICON)
		.resize(size, size)
		.png({ compressionLevel: 9 })
		.toBuffer();
	await writeFile(path, output);
};

const fixture = async (engine: 'capacitor' | 'expo' = 'capacitor') => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-mobile-branding-'));
	temporaryDirectories.push(root);
	await mkdir(join(root, 'brand'), { recursive: true });
	await writeFile(join(root, 'package.json'), '{"dependencies":{}}\n');
	await Promise.all(
		['icon.png', 'foreground.png', 'monochrome.png', 'dark.png'].map(
			(name) => png(join(root, 'brand', name))
		)
	);
	const input: MobileConfig = {
		appId: 'com.example.brand',
		appName: 'Brand',
		branding: {
			android: {
				backgroundColor: '#123abc',
				foreground: 'brand/foreground.png',
				monochrome: 'brand/monochrome.png'
			},
			icon: 'brand/icon.png',
			ios: { darkIcon: 'brand/dark.png' },
			splash: {
				backgroundColor: '#fefefe',
				darkBackgroundColor: '#010203',
				logoScale: 0.25
			}
		},
		engine,
		server: { productionOrigin: 'https://api.example.com' }
	};
	const config = normalizeAbsoluteMobileConfig(input, root);

	return { config, input, root };
};

describe('mobile branding', () => {
	test('rejects an upstream zero-exit error even when template artwork exists', async () => {
		const { config, root } = await fixture();
		const bin = join(root, 'node_modules', '.bin');
		const icons = join(
			config.nativeProjectDirectory,
			'android',
			'app',
			'src',
			'main',
			'res',
			'mipmap-xxxhdpi'
		);
		await Promise.all([
			mkdir(bin, { recursive: true }),
			mkdir(icons, { recursive: true })
		]);
		await png(join(icons, 'ic_launcher.png'), 192);
		await writeFile(
			join(bin, 'capacitor-assets'),
			'#!/usr/bin/env bun\nconsole.error("Unable to generate assets: fixture failure");\n',
			{ mode: 0o755 }
		);
		await expect(
			generateAbsoluteCapacitorBranding(config, root, {
				platforms: ['android']
			})
		).rejects.toThrow('reported an incomplete projection');
		expect((await inspectAbsoluteMobileBranding(config, root)).ready).toBe(
			false
		);
	});

	test('normalizes paths, colors, defaults, and rejects unsafe inputs', async () => {
		const { config, input, root } = await fixture();
		expect(config.branding).toMatchObject({
			android: { backgroundColor: '#123ABC' },
			splash: {
				backgroundColor: '#FEFEFE',
				darkBackgroundColor: '#010203',
				logoScale: 0.25
			}
		});
		expect(config.branding?.icon).toBe(join(root, 'brand', 'icon.png'));
		expect(() =>
			normalizeAbsoluteMobileConfig(
				{
					...input,
					branding: { icon: '../outside.png' }
				},
				root
			)
		).toThrow('must remain inside the project root');
		expect(() =>
			normalizeAbsoluteMobileConfig(
				{
					...input,
					branding: {
						icon: 'brand/icon.jpg'
					}
				},
				root
			)
		).toThrow('must reference a PNG');
	});

	test('validates bounded source images and creates a stable non-secret manifest', async () => {
		const { config, root } = await fixture();
		const first = await createAbsoluteMobileBrandingManifest(config, root);
		const second = await createAbsoluteMobileBrandingManifest(config, root);

		expect(first).toEqual(second);
		expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
		expect(first.sources).toHaveLength(4);
		expect(JSON.stringify(first)).not.toContain(root);
		await png(join(root, 'brand', 'icon.png'), 512);
		await expect(
			createAbsoluteMobileBrandingManifest(config, root)
		).rejects.toThrow('at least 1024x1024');
	});

	test('projects the shared source contract into Expo config and managed inputs', async () => {
		const { config, root } = await fixture('expo');
		const projected = absoluteExpoBrandingConfig(config);
		expect(projected).toMatchObject({
			android: {
				adaptiveIcon: {
					backgroundColor: '#123ABC',
					foregroundImage:
						'./assets/absolute-branding/android-foreground.png',
					monochromeImage:
						'./assets/absolute-branding/android-monochrome.png'
				}
			},
			ios: {
				icon: {
					dark: './assets/absolute-branding/ios-dark.png',
					light: './assets/absolute-branding/icon.png'
				}
			}
		});
		await writeAbsoluteExpoProject(config, { projectRoot: root });
		const appConfig = JSON.parse(
			await readFile(
				join(config.nativeProjectDirectory, 'app.json'),
				'utf8'
			)
		);
		const expoPackage = JSON.parse(
			await readFile(
				join(config.nativeProjectDirectory, 'package.json'),
				'utf8'
			)
		);
		expect(appConfig.expo.android.adaptiveIcon.monochromeImage).toBe(
			'./assets/absolute-branding/android-monochrome.png'
		);
		expect(
			appConfig.expo.plugins.some(
				(plugin: unknown) =>
					Array.isArray(plugin) && plugin[0] === 'expo-splash-screen'
			)
		).toBe(true);
		expect(expoPackage.dependencies['expo-splash-screen']).toBe('~57.0.9');
		expect(
			await new Bun.Image(
				join(
					config.nativeProjectDirectory,
					'assets',
					'absolute-branding',
					'icon.png'
				)
			).metadata()
		).toMatchObject({ height: 1024, width: 1024 });
		expect((await inspectAbsoluteMobileBranding(config, root)).status).toBe(
			'ready'
		);
	});

	test('wraps the pinned Capacitor generator and adds modern native variants', async () => {
		const { config, root } = await fixture();
		const resources = join(
			config.nativeProjectDirectory,
			'android',
			'app',
			'src',
			'main',
			'res'
		);
		const appIcons = join(
			config.nativeProjectDirectory,
			'ios',
			'App',
			'App',
			'Assets.xcassets',
			'AppIcon.appiconset'
		);
		let command: string[] = [];
		await generateAbsoluteCapacitorBranding(config, root, {
			runner: async (received) => {
				command = received;
				await Promise.all([
					mkdir(join(resources, 'mipmap-xxxhdpi'), {
						recursive: true
					}),
					mkdir(join(resources, 'mipmap-anydpi-v26'), {
						recursive: true
					}),
					mkdir(appIcons, { recursive: true })
				]);
				await Promise.all([
					png(
						join(resources, 'mipmap-xxxhdpi', 'ic_launcher.png'),
						192
					),
					png(join(appIcons, 'AppIcon-512@2x.png')),
					writeFile(
						join(appIcons, 'Contents.json'),
						JSON.stringify({ images: [], info: { version: 1 } })
					)
				]);
			}
		});

		expect(command).toContain('capacitor-assets');
		expect(command).toContain('--logoSplashScale');
		expect(command[command.indexOf('--assetPath') + 1]).toBe(
			'.absolutejs/mobile/branding/input'
		);
		expect(command[command.indexOf('--androidProject') + 1]).toBe(
			'mobile/android'
		);
		expect(command[command.indexOf('--iosProject') + 1]).toBe(
			'mobile/ios/App'
		);
		expect(ABSOLUTE_CAPACITOR_ASSETS_VERSION).toBe('3.0.5');
		expect(
			await readFile(
				join(resources, 'mipmap-anydpi-v26', 'ic_launcher.xml'),
				'utf8'
			)
		).toContain('<monochrome');
		const contents = JSON.parse(
			await readFile(join(appIcons, 'Contents.json'), 'utf8')
		);
		expect(contents.images).toContainEqual(
			expect.objectContaining({
				appearances: [{ appearance: 'luminosity', value: 'dark' }],
				platform: 'ios'
			})
		);
		expect((await inspectAbsoluteMobileBranding(config, root)).ready).toBe(
			true
		);
		await png(join(root, 'brand', 'icon.png'));
		await writeFile(
			join(root, 'brand', 'icon.png'),
			Buffer.from('changed')
		);
		expect((await inspectAbsoluteMobileBranding(config, root)).status).toBe(
			'invalid'
		);
	});

	test('tracks platform-specific generation without declaring unfinished work ready', async () => {
		const { config, root } = await fixture();
		const resources = join(
			config.nativeProjectDirectory,
			'android',
			'app',
			'src',
			'main',
			'res',
			'mipmap-xxxhdpi'
		);
		const appIcons = join(
			config.nativeProjectDirectory,
			'ios',
			'App',
			'App',
			'Assets.xcassets',
			'AppIcon.appiconset'
		);
		const runner = async () => {
			await Promise.all([
				mkdir(resources, { recursive: true }),
				mkdir(
					join(
						config.nativeProjectDirectory,
						'android',
						'app',
						'src',
						'main',
						'res',
						'mipmap-anydpi-v26'
					),
					{ recursive: true }
				),
				mkdir(appIcons, { recursive: true })
			]);
			await Promise.all([
				png(join(resources, 'ic_launcher.png'), 192),
				png(join(appIcons, 'AppIcon-512@2x.png')),
				writeFile(
					join(appIcons, 'Contents.json'),
					JSON.stringify({ images: [], info: { version: 1 } })
				)
			]);
		};

		await generateAbsoluteCapacitorBranding(config, root, {
			platforms: ['android'],
			runner
		});
		expect((await inspectAbsoluteMobileBranding(config, root)).status).toBe(
			'stale'
		);
		await generateAbsoluteCapacitorBranding(config, root, {
			platforms: ['ios'],
			runner
		});
		expect((await inspectAbsoluteMobileBranding(config, root)).status).toBe(
			'ready'
		);
	});
});
