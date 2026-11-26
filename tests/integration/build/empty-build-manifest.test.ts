import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { build } from '../../../src/core/build';

/* A build with nothing to build still writes `manifest.json`.
 *
 * The production server reads that file to start. A build with no entry
 * points returned early without writing it, so an app with no pages —
 * an API, or one whose pages are all `Response`s a route builds — could
 * not start under `absolute start`. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const fixtureRoot = join(
	repoRoot,
	'.test-builds',
	`empty-build-${process.pid}`
);
const buildDir = join(fixtureRoot, 'build');
const buildOptions: Parameters<typeof build>[0] = {
	buildDirectory: relative(process.cwd(), buildDir),
	mode: 'production',
	options: { throwOnError: true }
};

afterAll(() => rm(fixtureRoot, { force: true, recursive: true }));

describe('a build with no entry points', () => {
	test('writes an empty manifest', async () => {
		await build(buildOptions);

		expect(existsSync(join(buildDir, 'manifest.json'))).toBe(true);
		expect(
			JSON.parse(await readFile(join(buildDir, 'manifest.json'), 'utf-8'))
		).toEqual({});
	});

	/* The pages were removed since the last build: their manifest must
	 * not go on naming bundles that are no longer there. */
	test('replaces the manifest a previous build left', async () => {
		await mkdir(buildDir, { recursive: true });
		await writeFile(
			join(buildDir, 'manifest.json'),
			JSON.stringify({ GoneIndex: '/gone.abc123.js' })
		);

		await build(buildOptions);

		expect(
			JSON.parse(await readFile(join(buildDir, 'manifest.json'), 'utf-8'))
		).toEqual({});
	});
});
