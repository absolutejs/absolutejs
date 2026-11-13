import { chmod, copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { imageOptimizer } from '../../../src/plugins/imageOptimizer';

const SOURCE_IMAGE = resolve(
	import.meta.dir,
	'..',
	'..',
	'..',
	'example',
	'assets',
	'png',
	'absolutejs-temp.png'
);
const IMAGE_URL =
	'/_absolute/image?url=%2Fassets%2Fpng%2Fabsolutejs-temp.png&w=640&q=75';

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map(async (root) => {
			await chmod(root, 0o700);
			await rm(root, { force: true, recursive: true });
		})
	);
});

const createBuildDirectory = async () => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-image-cache-'));
	roots.push(root);
	await mkdir(join(root, 'assets', 'png'), { recursive: true });
	await copyFile(
		SOURCE_IMAGE,
		join(root, 'assets', 'png', 'absolutejs-temp.png')
	);

	return root;
};

const requestImage = (plugin: ReturnType<typeof imageOptimizer>) =>
	new Elysia().use(plugin).handle(
		new Request(`http://localhost${IMAGE_URL}`, {
			headers: { accept: 'image/webp' }
		})
	);

describe.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
	'image optimizer over a build directory it cannot write',
	() => {
		test('the server boots and optimizes images without caching them', async () => {
			const buildDir = await createBuildDirectory();
			await chmod(buildDir, 0o500);

			const response = await requestImage(
				imageOptimizer(undefined, buildDir)
			);

			expect(response.status).toBe(200);
			expect(response.headers.get('content-type')).toBe('image/webp');
			expect(await readdir(buildDir)).toEqual(['assets']);
		});

		test('a writable build directory gets its cache on the first optimized image', async () => {
			const buildDir = await createBuildDirectory();
			const plugin = imageOptimizer(undefined, buildDir);
			expect(await readdir(buildDir)).toEqual(['assets']);

			const response = await requestImage(plugin);

			expect(response.status).toBe(200);
			expect(
				(await readdir(join(buildDir, '.cache', 'images'))).length
			).toBeGreaterThan(0);
		});
	}
);
