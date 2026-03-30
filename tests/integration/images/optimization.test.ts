import { resolve } from 'node:path';
import { describe, expect, test, afterAll, beforeAll } from 'bun:test';
import { startDevServer, type DevServer } from '../../helpers/devServer';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..');
const FIXTURE = resolve(PROJECT_ROOT, 'tests/fixtures/images');
const ENDPOINT = '/_absolute/image';
const TEST_IMAGE = '%2Fassets%2Fjpg%2Ftest.jpg';

const fetchImage = (baseUrl: string, width: number, accept: string) =>
	fetch(`${baseUrl}${ENDPOINT}?url=${TEST_IMAGE}&w=${width}&q=75`, {
		headers: { Accept: accept }
	});

describe('webp format', () => {
	let server: DevServer;

	beforeAll(async () => {
		server = await startDevServer({
			configPath: resolve(FIXTURE, 'config.webp.ts'),
			serverEntry: resolve(FIXTURE, 'server.ts')
		});
	}, 60_000);

	afterAll(async () => {
		await server?.kill();
	});

	test('returns webp when accepted', async () => {
		const res = await fetchImage(server.baseUrl, 128, 'image/webp,*/*');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/webp');
	});

	test('returns jpeg when webp not accepted', async () => {
		const res = await fetchImage(server.baseUrl, 128, 'image/jpeg,*/*');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/jpeg');
	});

	test('does not return avif when only webp configured', async () => {
		const res = await fetchImage(
			server.baseUrl,
			128,
			'image/avif,image/webp,*/*'
		);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/webp');
	});

	test('serves all valid sizes', async () => {
		for (const width of [64, 128, 384, 640, 1200]) {
			const res = await fetchImage(
				server.baseUrl,
				width,
				'image/webp,*/*'
			);
			expect(res.status).toBe(200);
			expect(res.headers.get('content-type')).toBe('image/webp');
		}
	});

	test('rejects invalid width', async () => {
		const res = await fetchImage(server.baseUrl, 999, 'image/webp,*/*');
		expect(res.status).toBe(400);
	});

	test('sets cache headers', async () => {
		const res = await fetchImage(server.baseUrl, 128, 'image/webp,*/*');
		expect(res.headers.get('cache-control')).toContain('public');
		expect(res.headers.get('vary')).toBe('Accept');
		expect(res.headers.get('etag')).toBeTruthy();
	});
});

describe('avif format', () => {
	let server: DevServer;

	beforeAll(async () => {
		server = await startDevServer({
			configPath: resolve(FIXTURE, 'config.avif.ts'),
			serverEntry: resolve(FIXTURE, 'server.ts')
		});
	}, 60_000);

	afterAll(async () => {
		await server?.kill();
	});

	test('returns avif when accepted', async () => {
		const res = await fetchImage(server.baseUrl, 128, 'image/avif,*/*');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/avif');
	});

	test('returns jpeg when avif not accepted', async () => {
		const res = await fetchImage(server.baseUrl, 128, 'image/jpeg,*/*');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/jpeg');
	});

	test('does not return webp when only avif configured', async () => {
		const res = await fetchImage(
			server.baseUrl,
			128,
			'image/avif,image/webp,*/*'
		);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/avif');
	});

	test('serves all valid sizes', async () => {
		for (const width of [64, 128, 384, 640, 1200]) {
			const res = await fetchImage(
				server.baseUrl,
				width,
				'image/avif,*/*'
			);
			expect(res.status).toBe(200);
			expect(res.headers.get('content-type')).toBe('image/avif');
		}
	});
});
