import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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

for (const bundleDirectory of ['dist', 'dist/cli', 'dist/dev']) {
	test(`published ${bundleDirectory} bundle discovers Sync runtime vendors`, async () => {
		const root = await mkdtemp(resolve(tmpdir(), 'absolute-hmr-runtime-'));
		try {
			const clientDirectory = resolve(root, 'dist/dev/client');
			await mkdir(clientDirectory, { recursive: true });
			await cp(
				resolve(import.meta.dir, '../../../src/dev/client'),
				clientDirectory,
				{ recursive: true }
			);
			const entry = resolve(root, bundleDirectory, 'runtime-paths.js');
			const result = await Bun.build({
				entrypoints: [
					resolve(import.meta.dir, '../../../src/dev/runtimePaths.ts')
				],
				format: 'esm',
				naming: 'runtime-paths.js',
				outdir: resolve(root, bundleDirectory),
				target: 'bun'
			});
			expect(result.success).toBe(true);
			const runtime = await import(entry);
			expect(runtime.resolveDevClientDirectory()).toBe(clientDirectory);
			const paths = await computeDepVendorPaths([
				runtime.resolveDevClientDirectory()
			]);
			expect(paths['@absolutejs/sync/client/runtime']).toBe(
				'/vendor/_absolutejs_sync_client_runtime.js'
			);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});
}
