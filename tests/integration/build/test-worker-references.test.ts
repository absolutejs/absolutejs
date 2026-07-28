import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build } from '../../../src/core/build';

const tempDirs: string[] = [];
const projectRoot = resolve(import.meta.dir, '..', '..', '..');
const testBuildRoot = join(projectRoot, '.test-builds');

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		await rm(dir, { force: true, recursive: true });
	}
});

describe('production worker entry discovery', () => {
	test('does not browser-bundle a Bun-only file referenced only by a test', async () => {
		await mkdir(testBuildRoot, { recursive: true });
		const fixtureRoot = await mkdtemp(
			join(testBuildRoot, 'absolute-worker-build-')
		);
		tempDirs.push(fixtureRoot);
		const sourceRoot = join(fixtureRoot, 'src');
		await mkdir(join(sourceRoot, 'pages'), { recursive: true });
		await writeFile(
			join(sourceRoot, 'boundary.test.ts'),
			'new URL("./server-only.ts", import.meta.url);'
		);
		await writeFile(
			join(sourceRoot, 'server-only.ts'),
			'import { dlopen } from "bun:ffi"; void dlopen;'
		);

		const result = await build({
			buildDirectory: join(fixtureRoot, 'build'),
			cwd: fixtureRoot,
			options: { throwOnError: true },
			reactDirectory: sourceRoot
		});

		expect(result?.manifest ?? {}).toEqual({});
	});
});
