import { afterEach, describe, expect, test } from 'bun:test';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
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
	test('emits React worker entries inside the configured build directory', async () => {
		await mkdir(testBuildRoot, { recursive: true });
		const fixtureRoot = await mkdtemp(
			join(testBuildRoot, 'absolute-worker-output-')
		);
		tempDirs.push(fixtureRoot);
		const reactRoot = join(fixtureRoot, 'react');
		const buildRoot = join(fixtureRoot, 'build');
		await mkdir(join(reactRoot, 'client'), { recursive: true });
		await mkdir(join(reactRoot, 'pages'), { recursive: true });
		await writeFile(
			join(reactRoot, 'client', 'featureWorker.ts'),
			'self.postMessage("ready");'
		);
		await writeFile(
			join(reactRoot, 'pages', 'home.tsx'),
			'export function Home() { new Worker(new URL("../client/featureWorker.ts", import.meta.url)); return null; }'
		);

		const result = await build({
			buildDirectory: buildRoot,
			cwd: fixtureRoot,
			options: { throwOnError: true },
			reactDirectory: reactRoot
		});
		const workerUrl = Object.values(result?.manifest ?? {}).find((url) =>
			basename(url).startsWith('featureWorker.')
		);

		expect(workerUrl).toStartWith('/');
		expect(workerUrl).not.toContain('/../');
		await access(join(buildRoot, workerUrl!.slice(1)));
	});

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
