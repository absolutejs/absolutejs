import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
	PRODUCTION_RUNTIME_FILE,
	readProductionRuntime,
	writeProductionRuntime
} from '../../../src/core/productionRuntime';
import type { BuildConfig } from '../../../types/build';

const withBuildDirectory = async (
	run: (directory: string) => Promise<void>
) => {
	const directory = await mkdtemp(join(tmpdir(), 'absolute-runtime-'));
	try {
		await run(directory);
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
};

describe('production runtime config', () => {
	test('keeps what the server reads and drops build-only settings and functions', () =>
		withBuildDirectory(async (directory) => {
			const loader = ({ src }: { src: string }) => src;
			const config: BuildConfig = {
				buildDirectory: '/where/it/was/built',
				images: {
					formats: ['webp'],
					loader,
					quality: 70
				},
				islands: { registry: './src/islands/registry.ts' },
				reactDirectory: './src/frontend',
				sitemap: {
					baseUrl: 'https://example.test',
					routes: async () => ['/a']
				},
				static: { revalidate: 60, routes: ['/'] },
				tailwind: { input: './a.css', output: 'a.css' },
				telemetry: true
			};
			writeProductionRuntime(config, directory);

			expect(readProductionRuntime(directory)).toEqual({
				buildDirectory: directory,
				images: { formats: ['webp'], quality: 70 },
				islands: { registry: './src/islands/registry.ts' },
				reactDirectory: './src/frontend',
				static: { revalidate: 60, routes: ['/'] },
				telemetry: true
			});
		}));

	test('keeps Angular change detection but not Angular providers', () =>
		withBuildDirectory(async (directory) => {
			const config: BuildConfig = {
				angular: { changeDetection: 'zone', providers: [] },
				angularDirectory: './src/angular'
			};
			writeProductionRuntime(config, directory);

			expect(readProductionRuntime(directory)).toEqual({
				angular: { changeDetection: 'zone' },
				angularDirectory: './src/angular',
				buildDirectory: directory
			});
		}));

	/* The failure mode this file has to guard, and did not.
	 *
	 * `prepare()` copies `basePath` into `ABSOLUTE_BASE_PATH` immediately
	 * after loading the config, and `getBasePath()` reads nothing else. In
	 * dev the config is absolute.config.ts, so a base path worked; in
	 * production it is this file, and the key was not in the allowlist —
	 * so the prefix silently disappeared. Measured on the example app with
	 * `basePath: '/portal'`: the production build served pages with no
	 * import map and no prefixed module URLs, and the same build with
	 * `ABSOLUTE_BASE_PATH=/portal` in the environment served both.
	 *
	 * The test above could not catch it, because it asserts a list of keys
	 * someone wrote by hand — the same hand that left this one out. A key
	 * the production runtime reads belongs here the day it is added. */
	test('keeps the base path, which production reads from nowhere else', () =>
		withBuildDirectory(async (directory) => {
			const config: BuildConfig = {
				basePath: '/portal',
				basePathShared: ['/react/vendor/'],
				reactDirectory: './src/frontend'
			};
			writeProductionRuntime(config, directory);

			expect(readProductionRuntime(directory)).toEqual({
				basePath: '/portal',
				basePathShared: ['/react/vendor/'],
				buildDirectory: directory,
				reactDirectory: './src/frontend'
			});
		}));

	test('keeps the logging config, which the access log plugin reads', () =>
		withBuildDirectory(async (directory) => {
			const config: BuildConfig = {
				logging: { echoRequestId: false, requests: 'text' },
				reactDirectory: './src/frontend'
			};
			writeProductionRuntime(config, directory);

			expect(readProductionRuntime(directory)).toEqual({
				buildDirectory: directory,
				logging: { echoRequestId: false, requests: 'text' },
				reactDirectory: './src/frontend'
			});
		}));

	test('is absent for a build without one or from another version', () =>
		withBuildDirectory(async (directory) => {
			expect(readProductionRuntime(directory)).toBeNull();
			await writeFile(
				join(directory, PRODUCTION_RUNTIME_FILE),
				JSON.stringify({ config: {}, version: 999 })
			);
			expect(readProductionRuntime(directory)).toBeNull();
		}));
});
