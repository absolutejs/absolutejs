import { afterAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { staticPlugin } from '@elysia/static';
import { Elysia } from 'elysia';
import { createAssetCachePlugin } from '../../../src/core/precompressed';

const roots: string[] = [];
afterAll(async () => {
	await Promise.all(
		roots.map((root) => rm(root, { force: true, recursive: true }))
	);
});

/* @elysia/static answers a plain GET with the file itself and puts its
 * blanket `max-age=86400` on `set.headers`; a hashed font must still come
 * back immutable, the way the production runtime mounts both plugins. */
test('hashed static files get the immutable policy on a plain GET', async () => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-asset-cache-'));
	roots.push(root);
	await mkdir(join(root, 'assets', 'fonts'), { recursive: true });
	await writeFile(
		join(
			root,
			'assets',
			'fonts',
			'poppins-latin-400-normal.3dc5d0c5.woff2'
		),
		'woff2'
	);
	await writeFile(join(root, 'assets', 'logo.png'), 'png');
	const app = new Elysia()
		.use(createAssetCachePlugin())
		.use(
			await staticPlugin({ alwaysStatic: true, assets: root, prefix: '' })
		)
		.get('/api/data.json', () => ({ ok: true }));

	const font = await app.handle(
		new Request(
			'http://localhost/assets/fonts/poppins-latin-400-normal.3dc5d0c5.woff2'
		)
	);
	expect(font.status).toBe(200);
	expect(font.headers.get('cache-control')).toBe(
		'public, max-age=31536000, immutable'
	);

	const logo = await app.handle(
		new Request('http://localhost/assets/logo.png')
	);
	expect(logo.headers.get('cache-control')).toBe(
		'public, max-age=0, must-revalidate'
	);

	const api = await app.handle(new Request('http://localhost/api/data.json'));
	expect(api.headers.get('cache-control')).toBeNull();
});
