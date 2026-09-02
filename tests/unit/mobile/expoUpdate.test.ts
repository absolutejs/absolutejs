import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	ABSOLUTE_EXPO_UPDATE_DESCRIPTOR,
	finalizeAbsoluteExpoUpdateExport,
	parseAbsoluteExpoUpdateDescriptor
} from '../../../src/mobile/expoUpdate';

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots
			.splice(0)
			.map((root) => rm(root, { force: true, recursive: true }))
	);
});

describe('Expo production update artifact', () => {
	test('captures and validates both platform launch bundles and shared assets', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-expo-update-'));
		roots.push(root);
		await mkdir(join(root, '_expo/static/js/ios'), { recursive: true });
		await mkdir(join(root, '_expo/static/js/android'), {
			recursive: true
		});
		await mkdir(join(root, 'assets'), { recursive: true });
		await Promise.all([
			writeFile(join(root, '_expo/static/js/ios/entry.hbc'), 'ios'),
			writeFile(
				join(root, '_expo/static/js/android/entry.hbc'),
				'android'
			),
			writeFile(join(root, 'assets/image.png'), 'image'),
			writeFile(
				join(root, 'metadata.json'),
				JSON.stringify({
					fileMetadata: {
						android: {
							assets: [{ ext: 'png', path: 'assets/image.png' }],
							bundle: '_expo/static/js/android/entry.hbc'
						},
						ios: {
							assets: [{ ext: 'png', path: 'assets/image.png' }],
							bundle: '_expo/static/js/ios/entry.hbc'
						}
					}
				})
			)
		]);
		const runtimeVersion = 'a'.repeat(64);
		const result = await finalizeAbsoluteExpoUpdateExport({
			expoConfig: { name: 'App', slug: 'app' },
			exportDirectory: root,
			runtimeVersion
		});

		expect(result.descriptor.platforms.ios?.launchAsset.path).toBe(
			'_expo/static/js/ios/entry.hbc'
		);
		expect(result.descriptor.platforms.android?.assets).toEqual([
			{ extension: 'png', path: 'assets/image.png' }
		]);
		expect(
			parseAbsoluteExpoUpdateDescriptor(
				JSON.parse(
					await readFile(
						join(root, ABSOLUTE_EXPO_UPDATE_DESCRIPTOR),
						'utf8'
					)
				)
			).runtimeVersion
		).toBe(runtimeVersion);
	});

	test('rejects metadata that escapes the immutable export', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-expo-update-'));
		roots.push(root);
		await writeFile(
			join(root, 'metadata.json'),
			JSON.stringify({
				fileMetadata: {
					ios: { assets: [], bundle: '../outside.js' }
				}
			})
		);

		await expect(
			finalizeAbsoluteExpoUpdateExport({
				expoConfig: {},
				exportDirectory: root,
				runtimeVersion: 'b'.repeat(64)
			})
		).rejects.toThrow('relative path');
	});
});
