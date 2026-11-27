import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	asksForSharedCaching,
	serveValidated,
	warnCacheUnderNonces
} from '../../../src/core/prerenderValidators';

/* A pre-rendered page served so that a cache may keep it: the tag, the
 * 304, and the policy (`static.cache`, and the shell of a partial page
 * in edge mode). */

const directories: string[] = [];
afterAll(async () => {
	await Promise.all(
		directories.map((dir) => rm(dir, { force: true, recursive: true }))
	);
});

const PAGE = '<!doctype html><html><body><h1>About</h1></body></html>';

const pageFile = async (html = PAGE) => {
	const dir = await mkdtemp(join(tmpdir(), 'absolute-validators-'));
	directories.push(dir);
	const filePath = join(dir, 'about.html');
	await Bun.write(filePath, html);

	return filePath;
};

const ask = (
	filePath: string,
	headers: Record<string, string> = {},
	policy: Parameters<typeof serveValidated>[0]['policy'] = true
) =>
	serveValidated({
		filePath,
		kind: 'page',
		policy,
		request: new Request('http://localhost/about', { headers })
	});

describe('whether a policy asks for shared caching', () => {
	test('true and a lifetime do; absent and false do not', () => {
		expect(asksForSharedCaching(true)).toBe(true);
		expect(asksForSharedCaching({ maxAge: 60 })).toBe(true);
		expect(asksForSharedCaching({})).toBe(true);
		expect(asksForSharedCaching(false)).toBe(false);
		expect(asksForSharedCaching(undefined)).toBe(false);
	});
});

describe('a pre-rendered page served for a cache to keep', () => {
	test('is the file, tagged, public, and checked before each use', async () => {
		const response = await ask(await pageFile());

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe(
			'text/html; charset=utf-8'
		);
		expect(response.headers.get('cache-control')).toBe('public, no-cache');
		expect(response.headers.get('etag')).toMatch(/^"[^"]+"$/);
		// The address also answers requests for the page's data.
		expect(response.headers.get('vary')).toBe('Accept');
		expect(await response.text()).toBe(PAGE);
	});

	test('with a lifetime, a shared cache answers on its own for that long', async () => {
		const response = await ask(await pageFile(), {}, { maxAge: 120.9 });

		expect(response.headers.get('cache-control')).toBe(
			'public, max-age=0, s-maxage=120, must-revalidate'
		);
	});

	test('a lifetime of nothing is the same as none', async () => {
		const response = await ask(await pageFile(), {}, { maxAge: 0 });

		expect(response.headers.get('cache-control')).toBe('public, no-cache');
	});

	test('a current copy is confirmed with 304 and no body', async () => {
		const filePath = await pageFile();
		const etag = (await ask(filePath)).headers.get('etag') ?? '';

		const current = await ask(filePath, { 'if-none-match': etag });
		// What a cache that compressed the page sends back.
		const weakened = await ask(filePath, {
			'if-none-match': `W/${etag}`
		});
		const oneOfSeveral = await ask(filePath, {
			'if-none-match': `"older", ${etag}`
		});
		const stale = await ask(filePath, { 'if-none-match': '"older"' });

		expect(current.status).toBe(304);
		expect(await current.text()).toBe('');
		expect(current.headers.get('etag')).toBe(etag);
		expect(current.headers.get('cache-control')).toBe('public, no-cache');
		expect(weakened.status).toBe(304);
		expect(oneOfSeveral.status).toBe(304);
		expect(stale.status).toBe(200);
	});

	test('the same page has the same tag every time it is asked for', async () => {
		const filePath = await pageFile();

		expect((await ask(filePath)).headers.get('etag')).toBe(
			(await ask(filePath)).headers.get('etag')
		);
	});

	test('a page rendered again has a new tag, and the old copy is not current', async () => {
		const filePath = await pageFile();
		const before = (await ask(filePath)).headers.get('etag') ?? '';

		await Bun.write(filePath, PAGE.replace('About', 'About us, at length'));
		const after = await ask(filePath, { 'if-none-match': before });

		expect(after.status).toBe(200);
		expect(after.headers.get('etag')).not.toBe(before);
		expect(await after.text()).toContain('About us, at length');
	});

	/* A partial page's shell is its file with a loader added: what is
	 * tagged is what is sent, not what is on disk. */
	test('tags what is sent when the file is changed on the way out', async () => {
		const filePath = await pageFile();
		const plain = await ask(filePath);
		const changed = await serveValidated({
			filePath,
			kind: 'edge-shell',
			policy: true,
			request: new Request('http://localhost/about'),
			transform: (html) =>
				html.replace('</body>', '<script></script></body>')
		});

		expect(await changed.text()).toContain('<script></script>');
		expect(changed.headers.get('etag')).not.toBe(plain.headers.get('etag'));
		// Each reading of the file keeps its own.
		expect((await ask(filePath)).headers.get('etag')).toBe(
			plain.headers.get('etag')
		);
	});
});

describe('static.cache under per-request CSP nonces', () => {
	test('is said to do nothing, once', () => {
		const logged: string[] = [];
		const original = console.log;
		console.log = (...parts: unknown[]) => {
			logged.push(parts.map(String).join(' '));
		};
		try {
			warnCacheUnderNonces(undefined);
			warnCacheUnderNonces(false);
			expect(logged).toEqual([]);
			warnCacheUnderNonces(true);
			warnCacheUnderNonces({ maxAge: 60 });
		} finally {
			console.log = original;
		}

		expect(logged).toHaveLength(1);
		expect(logged[0]).toContain('static.cache');
	});
});
