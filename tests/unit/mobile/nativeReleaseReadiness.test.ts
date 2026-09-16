import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeAbsoluteMobileConfig } from '../../../src/mobile/config';
import { applyAbsoluteNativeReleaseReadiness } from '../../../src/mobile/nativeReleaseReadiness';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});

const fixture = async (kotlin: boolean) => {
	const root = await mkdtemp(
		join(tmpdir(), 'absolute-native-release-readiness-')
	);
	temporaryDirectories.push(root);
	const config = normalizeAbsoluteMobileConfig(
		{
			appId: 'com.example.absolute',
			appName: 'Absolute readiness',
			platforms: ['android'],
			server: { productionOrigin: 'https://example.com' }
		},
		root
	);
	const packageRoot = join(
		config.nativeProjectDirectory,
		`android/app/src/main/${kotlin ? 'kotlin' : 'java'}/com/example/absolute`
	);
	await mkdir(packageRoot, { recursive: true });
	const activityPath = join(
		packageRoot,
		`MainActivity.${kotlin ? 'kt' : 'java'}`
	);
	await writeFile(
		activityPath,
		kotlin
			? `package com.example.absolute\n\nimport com.getcapacitor.BridgeActivity\n\nclass MainActivity : BridgeActivity() {\n    override fun onCreate(savedInstanceState: android.os.Bundle?) {\n        super.onCreate(savedInstanceState)\n    }\n}\n`
			: `package com.example.absolute;\n\nimport com.getcapacitor.BridgeActivity;\n\npublic class MainActivity extends BridgeActivity {}\n`
	);

	return { activityPath, config };
};

describe('Capacitor Android release readiness projection', () => {
	test('generates and idempotently registers the Java plugin', async () => {
		const { activityPath, config } = await fixture(false);
		expect(
			(await applyAbsoluteNativeReleaseReadiness(config)).changed
		).toBe(true);
		expect(
			(await applyAbsoluteNativeReleaseReadiness(config)).changed
		).toBe(false);
		const activity = await readFile(activityPath, 'utf8');
		expect(activity).toContain(
			'registerPlugin(AbsoluteReleaseReadinessPlugin.class);'
		);
		expect(
			activity.match(/absolutejs:release-readiness:start/gu)
		).toHaveLength(1);
		const plugin = await readFile(
			join(
				config.nativeProjectDirectory,
				'android/app/src/main/java/com/example/absolute/AbsoluteReleaseReadinessPlugin.java'
			),
			'utf8'
		);
		expect(plugin).toContain(
			'Log.i("AbsoluteJS", "Capacitor embedded web content ready")'
		);
		expect(plugin).not.toContain('PluginCall call.toString');
	});

	test('injects an existing Kotlin lifecycle without changing its syntax', async () => {
		const { activityPath, config } = await fixture(true);
		await applyAbsoluteNativeReleaseReadiness(config);
		await applyAbsoluteNativeReleaseReadiness(config);
		const activity = await readFile(activityPath, 'utf8');
		expect(activity).toContain(
			'registerPlugin(AbsoluteReleaseReadinessPlugin::class.java)'
		);
		expect(activity).toContain('override fun onCreate');
		expect(
			activity.match(/absolutejs:release-readiness:start/gu)
		).toHaveLength(1);
	});

	test('does not project into Expo applications', async () => {
		const { config } = await fixture(false);
		expect(
			(
				await applyAbsoluteNativeReleaseReadiness({
					...config,
					engine: 'expo'
				})
			).changed
		).toBe(false);
	});
});
