import { afterEach, describe, expect, test } from 'bun:test';
import { brotliDecompressSync } from 'node:zlib';
import { compressedText } from '../../../src/core/compressText';
import { setCompression } from '../../../src/utils/compressionRef';

/* A text response the framework makes itself, compressed. */

afterEach(() => setCompression(undefined));

const TEXT = `# Title\n\n${'The quick brown fox jumps over the lazy dog.\n'.repeat(60)}`;

const asking = (encoding: string, method = 'GET') =>
	new Request('http://localhost/page.md', {
		headers: { 'accept-encoding': encoding },
		method
	});

describe('compressedText', () => {
	test('compresses for a client that accepts it, keeping the headers given', async () => {
		const response = await compressedText(TEXT, asking('br, gzip'), {
			'content-type': 'text/markdown; charset=utf-8',
			vary: 'Accept'
		});

		expect(response.headers.get('content-encoding')).toBe('br');
		expect(response.headers.get('content-type')).toBe(
			'text/markdown; charset=utf-8'
		);
		expect(response.headers.get('vary')).toBe('Accept, Accept-Encoding');
		expect(
			brotliDecompressSync(
				Buffer.from(await response.arrayBuffer())
			).toString()
		).toBe(TEXT);
	});

	test('sends the text as it is when there is nothing to gain or nobody to gain it', async () => {
		const small = await compressedText('short', asking('br'), {});
		const identity = await compressedText(TEXT, asking('identity'), {});
		const head = await compressedText(TEXT, asking('br', 'HEAD'), {});

		for (const response of [small, identity, head])
			expect(response.headers.get('content-encoding')).toBeNull();
		expect(await identity.text()).toBe(TEXT);
	});

	test('is off with the pages when the config says so', async () => {
		setCompression({ pages: false });
		const response = await compressedText(TEXT, asking('br'), {});

		expect(response.headers.get('content-encoding')).toBeNull();
	});
});
