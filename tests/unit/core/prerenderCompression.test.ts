import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import {
	compressedPrerendered,
	compressedShell,
	resetPrerenderCompression
} from '../../../src/core/prerenderCompression';
import { setCompression } from '../../../src/utils/compressionRef';

/* A pre-rendered page, compressed once and kept. */

const roots: string[] = [];

afterEach(() => {
	resetPrerenderCompression();
	setCompression(undefined);
	for (const root of roots.splice(0))
		rmSync(root, { force: true, recursive: true });
});

const pageOf = (heading: string) =>
	`<html><body><h1>${heading}</h1>${'<p>The quick brown fox.</p>'.repeat(120)}</body></html>`;

const fileWith = (html: string) => {
	const root = mkdtempSync(join(tmpdir(), 'absolute-prerender-compress-'));
	roots.push(root);
	const path = join(root, 'page.html');
	writeFileSync(path, html);

	return path;
};

const asking = (encoding = 'br, gzip', method = 'GET') =>
	new Request('http://localhost/page', {
		headers: { 'accept-encoding': encoding },
		method
	});

const bytesOf = async (response: Response | undefined) =>
	Buffer.from((await response?.arrayBuffer()) ?? new ArrayBuffer(0));

describe('a pre-rendered page', () => {
	test('is compressed for a client that accepts it', async () => {
		const path = fileWith(pageOf('First'));
		const brotli = await compressedPrerendered(path, asking());
		const gzip = await compressedPrerendered(path, asking('gzip'));

		expect(brotli?.headers.get('content-encoding')).toBe('br');
		expect(brotli?.headers.get('vary')).toBe('accept-encoding');
		expect(brotliDecompressSync(await bytesOf(brotli)).toString()).toBe(
			pageOf('First')
		);
		expect(gunzipSync(await bytesOf(gzip)).toString()).toBe(
			pageOf('First')
		);
	});

	test('is sent as the file when there is nothing to gain or nobody to gain it', async () => {
		const small = fileWith('<html><body>tiny</body></html>');
		const big = fileWith(pageOf('Big'));

		expect(await compressedPrerendered(small, asking())).toBeUndefined();
		expect(
			await compressedPrerendered(big, asking('identity'))
		).toBeUndefined();
		expect(
			await compressedPrerendered(big, asking('br', 'HEAD'))
		).toBeUndefined();
		expect(
			await compressedPrerendered(join(small, 'missing'), asking())
		).toBeUndefined();
	});

	test('is not compressed when the config turns page compression off', async () => {
		setCompression({ pages: false });

		expect(
			await compressedPrerendered(fileWith(pageOf('Off')), asking())
		).toBeUndefined();
	});

	/* The copy names the version of the file it was made from. A page
	 * rendered again is a new version, and is compressed again. */
	test('rendered again is compressed again, not served from the old copy', async () => {
		const path = fileWith(pageOf('Before'));
		const before = await bytesOf(
			await compressedPrerendered(path, asking())
		);
		writeFileSync(path, pageOf('After, and longer'));
		const after = await bytesOf(
			await compressedPrerendered(path, asking())
		);

		expect(brotliDecompressSync(before).toString()).toContain('Before');
		expect(brotliDecompressSync(after).toString()).toContain(
			'After, and longer'
		);
	});

	test('of the same length is still seen to be new, by when it was written', async () => {
		const path = fileWith(pageOf('AAAA'));
		await compressedPrerendered(path, asking());
		writeFileSync(path, pageOf('BBBB'));
		const later = new Date(Date.now() + 5000);
		utimesSync(path, later, later);
		const after = await bytesOf(
			await compressedPrerendered(path, asking())
		);

		expect(brotliDecompressSync(after).toString()).toContain('BBBB');
	});

	test('asked for at once by several visitors is compressed to one copy', async () => {
		const path = fileWith(pageOf('Together'));
		const [first, second] = await Promise.all([
			compressedPrerendered(path, asking()),
			compressedPrerendered(path, asking())
		]);

		expect((await bytesOf(first)).equals(await bytesOf(second))).toBe(true);
	});
});

describe('a shell streamed with its dynamic parts', () => {
	const shell = () =>
		new Response(pageOf('Shell'), {
			headers: { 'content-type': 'text/html; charset=utf-8' }
		});

	test('is compressed as it streams', async () => {
		const response = compressedShell(shell(), asking());

		expect(response.headers.get('content-encoding')).toBe('br');
		expect(brotliDecompressSync(await bytesOf(response)).toString()).toBe(
			pageOf('Shell')
		);
	});

	test('is left as it is for a client that accepts no encoding, or an answer that is not a page', () => {
		const plain = shell();
		const refused = new Response('no', { status: 403 });

		expect(compressedShell(plain, asking('identity'))).toBe(plain);
		expect(compressedShell(refused, asking())).toBe(refused);
	});
});
