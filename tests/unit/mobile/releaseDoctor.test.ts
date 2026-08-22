import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeAbsoluteMobileConfig } from '../../../src/mobile/config';
import { inspectAbsoluteMobileRelease } from '../../../src/mobile/releaseDoctor';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});

const fixture = async () => {
	const projectRoot = await mkdtemp(
		join(tmpdir(), 'absolute-release-doctor-')
	);
	temporaryDirectories.push(projectRoot);
	const config = normalizeAbsoluteMobileConfig(
		{
			appId: 'com.example.release',
			appName: 'Release',
			platforms: ['android'],
			server: { productionOrigin: 'https://api.example.com' }
		},
		projectRoot
	);
	const main = join(
		config.nativeProjectDirectory,
		'android',
		'app',
		'src',
		'main'
	);
	const assets = join(main, 'assets');
	await mkdir(join(assets, 'public'), { recursive: true });
	await writeFile(
		join(assets, 'capacitor.config.json'),
		`${JSON.stringify({ appId: config.appId })}\n`
	);
	await writeFile(
		join(main, 'AndroidManifest.xml'),
		'<manifest><application /></manifest>\n'
	);
	await writeFile(
		join(assets, 'public', 'index.html'),
		'<main>Release</main>'
	);

	return { assets, config, main, projectRoot };
};

describe('mobile release doctor', () => {
	test('passes a production-safe Android projection', async () => {
		const { config, projectRoot } = await fixture();
		const result = await inspectAbsoluteMobileRelease(config, projectRoot);
		expect(result.ready).toBe(true);
		expect(result.checks).toHaveLength(4);
		expect(result.checks.every((check) => check.status === 'pass')).toBe(
			true
		);
	});

	test('rejects leaked live reload, cleartext, HMR, and an active journal', async () => {
		const { assets, config, main, projectRoot } = await fixture();
		await writeFile(
			join(assets, 'capacitor.config.json'),
			`${JSON.stringify({ server: { allowNavigation: ['*'], cleartext: true, url: 'http://localhost:3029' } })}\n`
		);
		await writeFile(
			join(main, 'AndroidManifest.xml'),
			'<manifest><application android:usesCleartextTraffic="true" /></manifest>\n'
		);
		await writeFile(
			join(assets, 'public', 'index.html'),
			'<script>window.__HMR_WS__ = new WebSocket("/hmr")</script>'
		);
		const journal = join(
			projectRoot,
			'.absolutejs',
			'mobile',
			'dev-session'
		);
		await mkdir(journal, { recursive: true });
		await writeFile(join(journal, 'journal.json'), '{}');

		const result = await inspectAbsoluteMobileRelease(config, projectRoot);
		expect(result.ready).toBe(false);
		expect(
			result.checks
				.filter((check) => check.status === 'fail')
				.map((check) => check.id)
		).toEqual([
			'android.dev-journal',
			'android.capacitor-config',
			'android.cleartext',
			'android.hmr-assets'
		]);
	});

	test('validates iOS production transport and rejects leaked development settings', async () => {
		const { config, projectRoot } = await fixture();
		config.platforms.push('ios');
		config.iosVersion = '1.0.0';
		const iosApp = join(config.nativeProjectDirectory, 'ios', 'App', 'App');
		await mkdir(join(iosApp, 'public'), { recursive: true });
		await writeFile(
			join(iosApp, 'capacitor.config.json'),
			`${JSON.stringify({ appId: config.appId })}\n`
		);
		await writeFile(join(iosApp, 'Info.plist'), '<plist><dict /></plist>');
		await writeFile(
			join(iosApp, 'public', 'index.html'),
			'<main>Safe</main>'
		);
		const safe = await inspectAbsoluteMobileRelease(config, projectRoot);
		expect(safe.ready).toBe(true);
		expect(
			safe.checks.filter(({ id }) => id.startsWith('ios.'))
		).toHaveLength(4);

		await writeFile(
			join(iosApp, 'Info.plist'),
			'<plist><dict><key>NSAllowsArbitraryLoads</key><true/></dict></plist>'
		);
		await writeFile(
			join(iosApp, 'public', 'index.html'),
			'<script>window.__HMR_WS__ = true</script>'
		);
		const unsafe = await inspectAbsoluteMobileRelease(config, projectRoot);
		expect(unsafe.ready).toBe(false);
		expect(
			unsafe.checks
				.filter((check) => check.status === 'fail')
				.map((check) => check.id)
		).toContain('ios.transport-security');
		expect(
			unsafe.checks
				.filter((check) => check.status === 'fail')
				.map((check) => check.id)
		).toContain('ios.hmr-assets');
	});
});
