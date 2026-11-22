import { afterEach, describe, expect, test } from 'bun:test';
import {
	clientBasePath,
	withClientBasePath,
	withoutClientBasePath
} from '../../../src/dev/client/basePath';
import {
	basePathHeadTags,
	getBasePath,
	insertAfterHeadOpen,
	normalizeBasePath,
	withBasePath
} from '../../../src/utils/basePath';

const streamOf = (...parts: (string | Uint8Array)[]) =>
	new ReadableStream<string | Uint8Array>({
		start(controller) {
			for (const part of parts) controller.enqueue(part);
			controller.close();
		}
	});

const previous = process.env.ABSOLUTE_BASE_PATH;
afterEach(() => {
	if (previous === undefined) delete process.env.ABSOLUTE_BASE_PATH;
	else process.env.ABSOLUTE_BASE_PATH = previous;
	Reflect.deleteProperty(globalThis, 'window');
});

describe('base path', () => {
	test('normalizes to a leading slash and no trailing one', () => {
		expect(normalizeBasePath('/studio/projects/abc/')).toBe(
			'/studio/projects/abc'
		);
		expect(normalizeBasePath('studio')).toBe('/studio');
		expect(normalizeBasePath('/')).toBe('');
		expect(normalizeBasePath(undefined)).toBe('');
	});

	test('is read from ABSOLUTE_BASE_PATH', () => {
		process.env.ABSOLUTE_BASE_PATH = '/studio/projects/abc/';
		expect(getBasePath()).toBe('/studio/projects/abc');
	});

	test('prefixes root-absolute URLs only, once', () => {
		const base = '/s/p';
		expect(withBasePath('/@src/x.tsx', base)).toBe('/s/p/@src/x.tsx');
		expect(withBasePath('/s/p/@src/x.tsx', base)).toBe('/s/p/@src/x.tsx');
		expect(withBasePath('./x.js', base)).toBe('./x.js');
		expect(withBasePath('//cdn.example/x.js', base)).toBe(
			'//cdn.example/x.js'
		);
		expect(withBasePath('https://x.example/a', base)).toBe(
			'https://x.example/a'
		);
		expect(withBasePath('', base)).toBe('');
		expect(withBasePath('/@src/x.tsx', '')).toBe('/@src/x.tsx');
	});

	test('head tags map every module prefix and expose the base', () => {
		const html = basePathHeadTags('/s/p', 'n0nce');
		const map = JSON.parse(
			/<script type="importmap" data-absolute-base-path nonce="n0nce">(.*?)<\/script>/.exec(
				html
			)?.[1] ?? '{}'
		);
		// Scoped to the base: the page and everything served under it, and
		// nothing another app serves at the origin's root.
		expect(map.imports).toBeUndefined();
		for (const scope of ['/s/p', '/s/p/']) {
			expect(map.scopes[scope]['/@src/']).toBe('/s/p/@src/');
			expect(map.scopes[scope]['/react/vendor/']).toBe(
				'/s/p/react/vendor/'
			);
		}
		expect(html).toContain('window.__ABSOLUTE_BASE_PATH__="/s/p";');
		expect(basePathHeadTags('')).toBe('');
	});

	test('the base cannot close the script it is written into', () => {
		expect(basePathHeadTags('/a</script><b')).not.toContain('</script><b');
	});

	test('inserts right after <head>, even split across chunks', async () => {
		const out = await new Response(
			insertAfterHeadOpen(
				streamOf(
					'<!DOCTYPE html><html><he',
					new TextEncoder().encode(
						'ad lang="en"><link rel="modulepreload" href="/x"/>'
					),
					'</head></html>'
				),
				'<MAP>'
			)
		).text();
		expect(out).toBe(
			'<!DOCTYPE html><html><head lang="en"><MAP><link rel="modulepreload" href="/x"/></head></html>'
		);
	});

	test('leaves the page alone with nothing to insert', async () => {
		const stream = streamOf('<head></head>');
		expect(insertAfterHeadOpen(stream, '')).toBe(stream);
	});

	test('browser code reads the base the head set', () => {
		Reflect.set(globalThis, 'window', { __ABSOLUTE_BASE_PATH__: '/s/p' });
		expect(clientBasePath()).toBe('/s/p');
		expect(withClientBasePath('/hmr')).toBe('/s/p/hmr');
		expect(withoutClientBasePath('/s/p/@src/a.css')).toBe('/@src/a.css');
		expect(withoutClientBasePath('/@src/a.css')).toBe('/@src/a.css');
	});
});
