import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	createAbsoluteIosNativeWatcher,
	isAbsoluteIosNativeRootInput
} from '../../../src/mobile/iosNativeWatcher';
import type { AbsoluteIosDevProject } from '../../../src/mobile/iosSimulatorController';
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
	const projectRoot = await mkdtemp(join(tmpdir(), 'absolute-ios-watch-'));
	temporaryDirectories.push(projectRoot);
	const config = normalizeAbsoluteMobileConfig(
		{
			appId: 'com.example.watch',
			appName: 'Watch',
			platforms: ['ios'],
			server: { productionOrigin: 'https://api.example.com' }
		},
		projectRoot
	);
	const nativeDirectory = join(config.nativeProjectDirectory, 'ios');
	await mkdir(join(nativeDirectory, 'App', 'App'), { recursive: true });
	await writeFile(
		join(nativeDirectory, 'App', 'App', 'AppDelegate.swift'),
		'import UIKit\n'
	);
	const project: AbsoluteIosDevProject = {
		cap: '/project/cap',
		config,
		nativeDirectory,
		projectRoot,
		xcodebuild: '/usr/bin/xcodebuild',
		xcrun: '/usr/bin/xcrun'
	};

	return { nativeDirectory, project };
};

describe('iOS native input watcher', () => {
	test('classifies both supported AbsoluteJS config filenames', () => {
		expect(isAbsoluteIosNativeRootInput('absolute.config.ts')).toBe(true);
		expect(isAbsoluteIosNativeRootInput('absolutejs.config.ts')).toBe(true);
		expect(isAbsoluteIosNativeRootInput('README.md')).toBe(false);
	});

	test('coalesces a native edit into one fingerprinted rebuild request', async () => {
		const { nativeDirectory, project } = await fixture();
		let resolveChange: (() => void) | undefined;
		const changed = new Promise<void>((resolve) => {
			resolveChange = resolve;
		});
		const changes: string[][] = [];
		const watcher = await createAbsoluteIosNativeWatcher({
			debounceMs: 20,
			project,
			onChange: async (change) => {
				changes.push(change.paths);
				resolveChange?.();
			}
		});
		await writeFile(
			join(nativeDirectory, 'App', 'App', 'AppDelegate.swift'),
			'import UIKit\n// changed\n'
		);
		await Promise.race([
			changed,
			Bun.sleep(5_000).then(() => {
				throw new Error('Timed out waiting for iOS watcher change.');
			})
		]);
		watcher.close();

		expect(changes).toHaveLength(1);
		expect(
			changes[0]?.some((path) => path.endsWith('AppDelegate.swift'))
		).toBe(true);
	});
});
