import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	prepareAbsoluteCapacitorInitialization,
	writeAbsoluteCapacitorConfig
} from '../../../src/mobile/capacitorProject';
import { normalizeAbsoluteMobileConfig } from '../../../src/mobile/config';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});

describe('Capacitor project config', () => {
	test('owns webDir and custom native source paths without a remote server URL', async () => {
		const root = await mkdtemp(
			join(tmpdir(), 'absolute-capacitor-project-')
		);
		temporaryDirectories.push(root);
		const config = normalizeAbsoluteMobileConfig(
			{
				appId: 'com.example.product',
				appName: 'Product',
				nativeProject: { directory: 'mobile' },
				server: { productionOrigin: 'https://api.example.com' }
			},
			root
		);

		const first = await writeAbsoluteCapacitorConfig(config, {
			projectRoot: root
		});
		const second = await writeAbsoluteCapacitorConfig(config, {
			projectRoot: root
		});
		const source = await readFile(first.path, 'utf8');

		expect(first.changed).toBe(true);
		expect(second.changed).toBe(false);
		expect(source).toContain('webDir: ".absolutejs/mobile/web"');
		expect(source).toContain('path: "mobile/android"');
		expect(source).toContain('path: "mobile/ios"');
		expect(source).not.toContain('server:');
	});
});

test('native initialization supports empty bundles and retries without overwriting app assets', async () => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-native-init-'));
	temporaryDirectories.push(root);
	const config = normalizeAbsoluteMobileConfig(
		{
			appId: 'com.example.product',
			appName: 'Product',
			platforms: ['ios', 'android'],
			server: { productionOrigin: 'https://api.example.com' }
		},
		root
	);
	expect(await prepareAbsoluteCapacitorInitialization(config)).toEqual([
		{ command: 'add', platform: 'ios' },
		{ command: 'add', platform: 'android' }
	]);
	const index = join(config.bundleDirectory, 'index.html');
	expect(await readFile(index, 'utf8')).toContain(
		'Build your AbsoluteJS mobile bundle'
	);
	await writeFile(index, '<h1>Actual built app</h1>');
	await mkdir(join(config.nativeProjectDirectory, 'ios'), {
		recursive: true
	});
	expect(await prepareAbsoluteCapacitorInitialization(config)).toEqual([
		{ command: 'sync', platform: 'ios' },
		{ command: 'add', platform: 'android' }
	]);
	expect(await readFile(index, 'utf8')).toBe('<h1>Actual built app</h1>');
});
