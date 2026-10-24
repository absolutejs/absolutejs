import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { Elysia } from 'elysia';
import {
	acceptedEncodings,
	createPrecompressedPlugin,
	writePrecompressedAssets
} from '../../../src/core/precompressed';

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(
		roots
			.splice(0)
			.map((root) => rm(root, { force: true, recursive: true }))
	);
});

const SCRIPT = `export const answer = ${JSON.stringify('lorem ipsum '.repeat(400))};\n`;

const buildDir = async () => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-precompressed-'));
	roots.push(root);
	await mkdir(join(root, 'react', 'vendor'), { recursive: true });
	await mkdir(join(root, '.absolutejs', 'generated'), { recursive: true });
	await writeFile(join(root, 'react', 'vendor', 'react.js'), SCRIPT);
	await writeFile(
		join(root, '.absolutejs', 'generated', 'Page.a1b2c3d4.js'),
		SCRIPT
	);
	await writeFile(join(root, 'tiny.css'), 'a{color:red}');
	await writeFile(join(root, 'photo.png'), new Uint8Array(4096).fill(7));

	return root;
};

describe('acceptedEncodings', () => {
	test('prefers brotli, falls back to gzip, honours q=0', () => {
		expect(
			acceptedEncodings('gzip, deflate, br').map((e) => e.encoding)
		).toEqual(['br', 'gzip']);
		expect(acceptedEncodings('gzip;q=0.8').map((e) => e.encoding)).toEqual([
			'gzip'
		]);
		expect(
			acceptedEncodings('br;q=0, gzip').map((e) => e.encoding)
		).toEqual(['gzip']);
		expect(acceptedEncodings(null)).toEqual([]);
	});
});

describe('precompressed assets', () => {
	test('the build writes brotli and gzip copies only where they pay', async () => {
		const root = await buildDir();
		expect(await writePrecompressedAssets(root)).toBe(2);
		const vendor = join(root, 'react', 'vendor', 'react.js');
		expect(
			brotliDecompressSync(
				await Bun.file(`${vendor}.br`).bytes()
			).toString()
		).toBe(SCRIPT);
		expect(
			gunzipSync(await Bun.file(`${vendor}.gz`).bytes()).toString()
		).toBe(SCRIPT);
		// Too small, and not text: left alone.
		expect(await Bun.file(join(root, 'tiny.css.br')).exists()).toBe(false);
		expect(await Bun.file(join(root, 'photo.png.br')).exists()).toBe(false);
	});

	test('the server sends a copy the browser accepts, and otherwise falls through', async () => {
		const root = await buildDir();
		await writePrecompressedAssets(root);
		const app = new Elysia()
			.use(await createPrecompressedPlugin(root))
			.get('/react/vendor/react.js', () => 'uncompressed');
		const request = (path: string, encoding?: string) =>
			app.handle(
				new Request(`http://localhost${path}`, {
					headers: encoding ? { 'accept-encoding': encoding } : {}
				})
			);

		const brotli = await request('/react/vendor/react.js', 'gzip, br');
		expect(brotli.headers.get('content-encoding')).toBe('br');
		expect(brotli.headers.get('content-type')).toContain('javascript');
		expect(brotli.headers.get('vary')).toBe('Accept-Encoding');
		expect(brotli.headers.get('cache-control')).toBe(
			'public, max-age=0, must-revalidate'
		);
		expect(
			brotliDecompressSync(
				new Uint8Array(await brotli.arrayBuffer())
			).toString()
		).toBe(SCRIPT);

		const hashed = await request(
			'/.absolutejs/generated/Page.a1b2c3d4.js',
			'gzip'
		);
		expect(hashed.headers.get('content-encoding')).toBe('gzip');
		expect(hashed.headers.get('cache-control')).toBe(
			'public, max-age=31536000, immutable'
		);

		const plain = await request('/react/vendor/react.js');
		expect(plain.headers.get('content-encoding')).toBeNull();
		expect(await plain.text()).toBe('uncompressed');
	});
});

// Exercise the HTTP boundary: malformed scanner requests must not become 500s,
// and URL-encoded filenames must resolve to the same indexed file on disk.
describe('encoded static paths', () => {
	test('rejects invalid UTF-8 and incomplete escapes without invoking error hooks', async () => {
		const root = await buildDir();
		await writePrecompressedAssets(root);
		const errors: unknown[] = [];
		const app = new Elysia()
			.use(await createPrecompressedPlugin(root))
			.onError(({ error }) => {
				errors.push(error);
			});
		for (const path of ['/..%c0%af..%c0%af.env', '/bad%', '/bad%GG']) {
			for (const method of ['GET', 'HEAD']) {
				const response = await app.handle(
					new Request(`http://localhost${path}`, { method })
				);
				expect(response.status).toBe(400);
			}
		}
		expect(errors).toEqual([]);
	});
	test('serves encoded filenames and does not decode a second time', async () => {
		const root = await buildDir();
		await writeFile(join(root, 'hello world.js'), SCRIPT);
		await writePrecompressedAssets(root);
		const app = new Elysia().use(await createPrecompressedPlugin(root));
		const response = await app.handle(
			new Request('http://localhost/hello%20world.js', {
				headers: { 'accept-encoding': 'br' }
			})
		);
		expect(response.status).toBe(200);
		expect(
			brotliDecompressSync(
				new Uint8Array(await response.arrayBuffer())
			).toString()
		).toBe(SCRIPT);
		const unknown = await app.handle(
			new Request('http://localhost/hello%2520world.js', {
				headers: { 'accept-encoding': 'br' }
			})
		);
		expect(unknown.status).toBe(404);
	});
});
