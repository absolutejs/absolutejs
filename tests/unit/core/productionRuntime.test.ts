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
