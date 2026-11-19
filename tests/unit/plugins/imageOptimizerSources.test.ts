import {
	copyFile,
	mkdir,
	mkdtemp,
	readdir,
	rm,
	utimes,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { imageOptimizer } from '../../../src/plugins/imageOptimizer';
import { pruneCache, readCacheSize } from '../../../src/utils/imageProcessing';

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
const SECRET = 'DATABASE_URL=postgres://user:hunter2@db.internal/app';

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots
			.splice(0)
			.map((root) => rm(root, { force: true, recursive: true }))
	);
});

const createBuildDirectory = async () => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-image-sources-'));
	roots.push(root);
	await mkdir(join(root, 'assets', 'png'), { recursive: true });
	await copyFile(
		SOURCE_IMAGE,
		join(root, 'assets', 'png', 'absolutejs-temp.png')
	);

	return root;
};

const requestImage = (buildDir: string, url: string) =>
	new Elysia()
		.use(imageOptimizer(undefined, buildDir))
		.handle(
			new Request(
				`http://localhost/_absolute/image?url=${encodeURIComponent(url)}&w=640&q=75`,
				{ headers: { accept: 'image/webp' } }
			)
		);

describe('image optimizer local sources', () => {
	test('an image in the build directory is optimized', async () => {
		const buildDir = await createBuildDirectory();

		const response = await requestImage(
			buildDir,
			'/assets/png/absolutejs-temp.png'
		);

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('image/webp');
	});

	test('a file that is not an image is never served', async () => {
		const buildDir = await createBuildDirectory();
		await writeFile(join(buildDir, 'absolute-runtime.json'), SECRET);

		const response = await requestImage(buildDir, 'absolute-runtime.json');

		expect(response.status).toBe(404);
		expect(await response.text()).not.toContain('hunter2');
	});

	test('a dotfile in the build directory is never served', async () => {
		const buildDir = await createBuildDirectory();
		await writeFile(join(buildDir, '.env'), SECRET);

		const response = await requestImage(buildDir, '.env');

		expect(response.status).toBe(404);
		expect(await response.text()).not.toContain('hunter2');
	});

	test('files under the project root but outside the build directory are not reachable', async () => {
		const buildDir = await createBuildDirectory();

		// The test process runs from the repository root, where both exist.
		const manifest = await requestImage(buildDir, 'package.json');
		const image = await requestImage(
			buildDir,
			'example/assets/png/absolutejs-temp.png'
		);

		expect(manifest.status).toBe(404);
		expect(await manifest.text()).not.toContain('"dependencies"');
		expect(image.status).toBe(404);
	});

	test('a refused source is not written to the image cache', async () => {
		const buildDir = await createBuildDirectory();
		await writeFile(join(buildDir, 'notes.txt'), SECRET);

		await requestImage(buildDir, 'notes.txt');
		const second = await requestImage(buildDir, 'notes.txt');

		expect(second.status).toBe(404);
	});
});

describe('image optimizer remote sources', () => {
	const servers: ReturnType<typeof Bun.serve>[] = [];

	afterEach(() => {
		servers.splice(0).forEach((server) => server.stop(true));
	});

	const serve = (
		fetch: (request: Request) => Response | Promise<Response>
	) => {
		const server = Bun.serve({ fetch, port: 0 });
		servers.push(server);

		return server;
	};

	const requestRemote = (buildDir: string, url: string) =>
		new Elysia()
			.use(
				imageOptimizer(
					{
						remotePatterns: [
							{
								hostname: 'localhost',
								port: new URL(url).port,
								protocol: 'http'
							}
						]
					},
					buildDir
				)
			)
			.handle(
				new Request(
					`http://localhost/_absolute/image?url=${encodeURIComponent(url)}&w=640&q=75`,
					{ headers: { accept: 'image/webp' } }
				)
			);

	test('an allowed remote image is optimized', async () => {
		const buildDir = await createBuildDirectory();
		const origin = serve(() => new Response(Bun.file(SOURCE_IMAGE)));

		const response = await requestRemote(
			buildDir,
			`http://localhost:${origin.port}/photo.png`
		);

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('image/webp');
	});

	test('a redirect to a host outside remotePatterns is refused', async () => {
		const buildDir = await createBuildDirectory();
		let internalHits = 0;
		const internal = serve(() => {
			internalHits += 1;

			return new Response(Bun.file(SOURCE_IMAGE));
		});
		const origin = serve(() =>
			Response.redirect(`http://localhost:${internal.port}/photo.png`)
		);

		const response = await requestRemote(
			buildDir,
			`http://localhost:${origin.port}/photo.png`
		);

		expect(response.status).toBe(502);
		expect(internalHits).toBe(0);
	});

	test('a redirect that stays inside remotePatterns is followed', async () => {
		const buildDir = await createBuildDirectory();
		const origin = serve((request) =>
			new URL(request.url).pathname === '/moved.png'
				? new Response(Bun.file(SOURCE_IMAGE))
				: new Response(null, {
						headers: { location: '/moved.png' },
						status: 302
					})
		);

		const response = await requestRemote(
			buildDir,
			`http://localhost:${origin.port}/photo.png`
		);

		expect(response.status).toBe(200);
	});

	test('a remote response that is not an image is refused', async () => {
		const buildDir = await createBuildDirectory();
		const origin = serve(() => new Response(SECRET));

		const response = await requestRemote(
			buildDir,
			`http://localhost:${origin.port}/photo.png`
		);

		expect(response.status).toBe(502);
		expect(await response.text()).not.toContain('hunter2');
	});
});

describe('image cache bound', () => {
	test('the oldest entries are deleted once the bound is passed', async () => {
		const cacheDir = await mkdtemp(join(tmpdir(), 'absolute-image-prune-'));
		roots.push(cacheDir);
		const entry = Buffer.alloc(1000);
		const names = ['oldest', 'middle', 'newest'];
		for (const [index, name] of names.entries()) {
			await writeFile(join(cacheDir, `${name}.data`), entry);
			await writeFile(join(cacheDir, `${name}.meta`), '{}');
			const time = new Date(Date.now() - (names.length - index) * 60_000);
			await utimes(join(cacheDir, `${name}.data`), time, time);
		}

		expect(readCacheSize(cacheDir)).toBe(3000);

		const remaining = pruneCache(cacheDir, 2500);

		expect(remaining).toBe(2000);
		expect((await readdir(cacheDir)).sort()).toEqual([
			'middle.data',
			'middle.meta',
			'newest.data',
			'newest.meta'
		]);
	});

	test('the plugin keeps its cache under maximumCacheSize', async () => {
		const buildDir = await createBuildDirectory();
		const plugin = imageOptimizer({ maximumCacheSize: 1 }, buildDir);
		const app = new Elysia().use(plugin);

		for (const width of [640, 750]) {
			const response = await app.handle(
				new Request(
					`http://localhost/_absolute/image?url=%2Fassets%2Fpng%2Fabsolutejs-temp.png&w=${width}&q=75`,
					{ headers: { accept: 'image/webp' } }
				)
			);
			expect(response.status).toBe(200);
		}

		expect(await readdir(join(buildDir, '.cache', 'images'))).toEqual([]);
	});
});
