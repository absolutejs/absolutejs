import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeAbsoluteMobileConfig } from '../../../src/mobile/config';
import {
	syncAbsoluteExpoWebAssets,
	writeAbsoluteExpoProject
} from '../../../src/mobile/expoProject';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});

const fixture = async () => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-expo-project-'));
	temporaryDirectories.push(root);
	await mkdir(join(root, 'mobile', 'native'), { recursive: true });
	await writeFile(
		join(root, 'mobile', 'native', 'scanner.tsx'),
		'export default function Scanner() { return null; }\n'
	);
	const config = normalizeAbsoluteMobileConfig(
		{
			appId: 'com.example.product',
			appName: 'Product',
			deepLinks: { hosts: ['app.example.com'], scheme: 'product' },
			engine: 'expo',
			routes: { native: { '/scanner': 'mobile/native/scanner.tsx' } },
			server: { productionOrigin: 'https://api.example.com' }
		},
		root
	);

	return { config, root };
};

describe('experimental Expo project', () => {
	test('generates a CNG shell with explicit native ownership and web catch-all', async () => {
		const { config, root } = await fixture();
		const first = await writeAbsoluteExpoProject(config, {
			projectRoot: root
		});
		const second = await writeAbsoluteExpoProject(config, {
			projectRoot: root
		});
		const project = config.nativeProjectDirectory;
		const [appConfig, nativeRoute, packageSource, webAssets, webHost] =
			await Promise.all([
				readFile(join(project, 'app.json'), 'utf8'),
				readFile(join(project, 'app', 'scanner', 'index.tsx'), 'utf8'),
				readFile(join(project, 'package.json'), 'utf8'),
				readFile(
					join(project, 'src', 'generated', 'webAssets.ts'),
					'utf8'
				),
				readFile(
					join(project, 'src', 'generated', 'AbsoluteWebHost.tsx'),
					'utf8'
				)
			]);

		expect(first.changed).toBeGreaterThan(0);
		expect(second.changed).toBe(0);
		expect(appConfig).toContain('applinks:app.example.com');
		expect(appConfig).toContain('"scheme": "product"');
		expect(nativeRoute).toContain('mobile/native/scanner');
		expect(packageSource).toContain('expo-dev-client');
		expect(webAssets).toContain('absolute prepare');
		expect(webHost).toContain('devices.haptics.impact');
		expect(webHost).toContain('EXPO_PUBLIC_ABSOLUTE_DEV_ANDROID_ORIGIN');
		expect(webHost).toContain("'expo-android'");
		expect(webHost).toContain('"/__absolute/native"');
		expect(
			await readFile(join(project, 'app', '[...absolute].tsx'), 'utf8')
		).toContain('AbsoluteWebHost');
	});

	test('materializes a Metro-safe opaque asset map preserving web paths', async () => {
		const { config, root } = await fixture();
		await writeAbsoluteExpoProject(config, { projectRoot: root });
		await mkdir(join(config.bundleDirectory, 'pages'), { recursive: true });
		await Promise.all([
			writeFile(
				join(config.bundleDirectory, 'index.html'),
				'<main></main>'
			),
			writeFile(
				join(config.bundleDirectory, 'absolute-mobile-manifest.json'),
				JSON.stringify({ appBuild: 'ambuild_test' })
			),
			writeFile(
				join(config.bundleDirectory, 'pages', 'app.js'),
				'export {};'
			)
		]);

		const result = await syncAbsoluteExpoWebAssets(config);
		const source = await readFile(
			join(
				config.nativeProjectDirectory,
				'src',
				'generated',
				'webAssets.ts'
			),
			'utf8'
		);

		expect(result).toMatchObject({ appBuild: 'ambuild_test', assets: 3 });
		expect(source).toContain('pages/app.js');
		expect(source).toContain('.absasset');
		expect(source).toContain("new File(root, 'index.html').uri");
	});

	test('does not adopt a populated custom directory without force', async () => {
		const { config, root } = await fixture();
		await mkdir(config.nativeProjectDirectory, { recursive: true });
		await writeFile(
			join(config.nativeProjectDirectory, 'README.md'),
			'mine'
		);

		await expect(
			writeAbsoluteExpoProject(config, { projectRoot: root })
		).rejects.toThrow('not AbsoluteJS-managed');
	});
});
