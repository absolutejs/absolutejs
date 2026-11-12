import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	renderedNonce,
	servePrerenderedPage,
	writeRenderedNonce
} from '../../../src/core/prerenderNonce';

/* A pre-rendered page carries the nonce of the request that rendered it.
 * Served under secureHeaders(), exactly that nonce is swapped for the
 * current request's; markup injected into the page couldn't have known it,
 * so anything carrying another nonce stays blocked. */

const directories: string[] = [];
afterAll(async () => {
	await Promise.all(
		directories.map((dir) => rm(dir, { force: true, recursive: true }))
	);
});

const PAGE = `<!doctype html><html><head><style nonce="RENDERED">p{}</style></head><body>
<script nonce="RENDERED">window.ok = 1</script>
<script nonce="GUESSED">window.injected = 1</script>
<script>window.plain = 1</script>
</body></html>`;

const writePage = async (withNonce: boolean) => {
	const dir = await mkdtemp(join(tmpdir(), 'absolute-prerender-nonce-'));
	directories.push(dir);
	const htmlPath = join(dir, 'index.html');
	await writeFile(htmlPath, PAGE);
	await writeRenderedNonce(htmlPath, withNonce ? 'RENDERED' : undefined);

	return htmlPath;
};

const HEADERS: Record<string, string> = {
	'content-security-policy': "script-src 'nonce-CURRENT'",
	'x-content-type-options': 'nosniff'
};

describe('pre-rendered pages under secureHeaders()', () => {
	test('reads the nonce a render used from its policy header', () => {
		const response = new Response('', {
			headers: {
				'content-security-policy':
					"default-src 'self'; script-src 'self' 'nonce-abc+/=='"
			}
		});

		expect(renderedNonce(response)).toBe('abc+/==');
		expect(renderedNonce(new Response(''))).toBeUndefined();
	});

	test('swaps only the render-time nonce for the request nonce', async () => {
		const htmlPath = await writePage(true);
		const { dropHeaders, response } = await servePrerenderedPage(
			htmlPath,
			'CURRENT',
			HEADERS
		);
		const html = await response.text();

		expect(dropHeaders).toEqual([]);
		expect(response.headers.get('content-security-policy')).toBe(
			"script-src 'nonce-CURRENT'"
		);
		expect(html).toContain('<style nonce="CURRENT">');
		expect(html).toContain('<script nonce="CURRENT">window.ok');
		expect(html).toContain('<script nonce="GUESSED">window.injected');
		expect(html).toContain('<script>window.plain');
		expect(html).not.toContain('RENDERED');
	});

	test('a page rendered without a nonce is served without a policy', async () => {
		const htmlPath = await writePage(false);
		const { dropHeaders, response } = await servePrerenderedPage(
			htmlPath,
			'CURRENT',
			HEADERS
		);

		expect(dropHeaders).toContain('content-security-policy');
		expect(response.headers.get('content-security-policy')).toBeNull();
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
	});
});
