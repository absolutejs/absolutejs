import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	createAbsoluteAndroidNativeWatcher,
	isAbsoluteAndroidNativeRootInput
} from '../../../src/mobile/androidNativeWatcher';
import type { AbsoluteAndroidDevProject } from '../../../src/mobile/androidEmulatorController';
import { normalizeAbsoluteMobileConfig } from '../../../src/mobile/config';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});

const fixture = async () => {
	const projectRoot = await mkdtemp(join(tmpdir(), 'absolute-native-watch-'));
	temporaryDirectories.push(projectRoot);
	const config = normalizeAbsoluteMobileConfig(
		{
			appId: 'com.example.watch',
			appName: 'Watch',
			platforms: ['android'],
			server: { productionOrigin: 'https://api.example.com' }
		},
		projectRoot
	);
	const nativeDirectory = join(config.nativeProjectDirectory, 'android');
	const dependency = join(
		nativeDirectory,
		'..',
		'..',
		'node_modules',
		'@capacitor',
		'android',
		'capacitor'
	);
	await mkdir(join(nativeDirectory, 'app'), { recursive: true });
	await mkdir(dependency, { recursive: true });
	await writeFile(
		join(nativeDirectory, 'capacitor.settings.gradle'),
		"include ':capacitor-android'\nproject(':capacitor-android').projectDir = new File('../../node_modules/@capacitor/android/capacitor')\n"
	);
	await writeFile(
		join(nativeDirectory, 'app', 'build.gradle'),
		'plugins {}\n'
	);
	await writeFile(join(dependency, 'build.gradle'), 'plugins {}\n');
	const project: AbsoluteAndroidDevProject = {
		adb: '/sdk/adb',
		androidRoot: '/sdk',
		cap: '/project/cap',
		config,
		emulator: '/sdk/emulator',
		host: 'linux',
		nativeDirectory,
		projectRoot
	};

	return { nativeDirectory, project };
};

describe('Android native input watcher', () => {
	test('classifies root files that can change native projection', () => {
		expect(isAbsoluteAndroidNativeRootInput('package.json')).toBe(true);
		expect(isAbsoluteAndroidNativeRootInput('bun.lock')).toBe(true);
		expect(isAbsoluteAndroidNativeRootInput('README.md')).toBe(false);
	});

	test('coalesces a native edit into one fingerprinted rebuild request', async () => {
		const { nativeDirectory, project } = await fixture();
		let resolveChange: (() => void) | undefined;
		const changed = new Promise<void>((resolve) => {
			resolveChange = resolve;
		});
		const changes: string[][] = [];
		const watcher = await createAbsoluteAndroidNativeWatcher({
			debounceMs: 20,
			project,
			onChange: async (change) => {
				changes.push(change.paths);
				resolveChange?.();
			}
		});
		await writeFile(
			join(nativeDirectory, 'app', 'build.gradle'),
			'plugins {}\n// changed\n'
		);
		await Promise.race([
			changed,
			Bun.sleep(5_000).then(() => {
				throw new Error('Timed out waiting for native watcher change.');
			})
		]);
		watcher.close();

		expect(changes).toHaveLength(1);
		expect(changes[0]?.some((path) => path.endsWith('build.gradle'))).toBe(
			true
		);
	});
});
