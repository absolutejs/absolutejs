import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { computeDepVendorPaths } from '../../../src/build/buildDepVendor';
import { collectDepVendorSourceDirs } from '../../../src/core/devBuild';
import type { BuildConfig } from '../../../types/build';

describe('dev dependency vendor sources', () => {
	test('includes browser runtime imports alongside application sources', async () => {
		const applicationDirectory = resolve(import.meta.dir, '../../fixtures');
		const sourceDirectories = collectDepVendorSourceDirs({
			reactDirectory: applicationDirectory
		} as BuildConfig);

		expect(sourceDirectories).toContain(applicationDirectory);
		expect(sourceDirectories).toContain(
			resolve(import.meta.dir, '../../../src/dev/client')
		);

		const paths = await computeDepVendorPaths(sourceDirectories);
		expect(paths['@absolutejs/sync/client/runtime']).toBe(
			'/vendor/_absolutejs_sync_client_runtime.js'
		);
	});
});
