import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	filenameToRoute,
	routeToFilename
} from '../../../src/core/prerenderPaths';

/* Pre-rendering writes a file per route and `prepare()` reads the
 * directory back on every boot to rebuild the route map, so the two
 * directions have to agree. They did not: the separator was flattened
 * (`/docs/guide` → `docs-guide.html`), which reads back as
 * `/docs-guide`. A nested route therefore missed its own cache and
 * rendered dynamically on every request, while its HTML answered a URL
 * nobody pre-rendered — and `/a/b` and `/a-b` wrote the same file. */

describe('routeToFilename', () => {
	test('mirrors the URL path', () => {
		expect(routeToFilename('/')).toBe('index.html');
		expect(routeToFilename('/about')).toBe('about.html');
		expect(routeToFilename('/docs/guide')).toBe('docs/guide.html');
		expect(routeToFilename('/docs/guide/intro')).toBe(
			'docs/guide/intro.html'
		);
	});

	test('gives two routes two files', () => {
		// Both were `a-b.html`, and whichever rendered last won.
		expect(routeToFilename('/a/b')).not.toBe(routeToFilename('/a-b'));
	});
});

describe('the round trip', () => {
	const routes = [
		'/',
		'/about',
		'/a-b',
		'/a/b',
		'/docs/guide/intro',
		'/blog/2026/11/a-post'
	];

	test('every route comes back as itself', () => {
		expect(
			routes.map((route) => filenameToRoute(routeToFilename(route)))
		).toEqual(routes);
	});

	test('a nested route is no longer served at a flattened URL', () => {
		expect(filenameToRoute(routeToFilename('/docs/guide'))).toBe(
			'/docs/guide'
		);
	});
});

/* What `prepare()` does with the directory: list it and rebuild the map.
 * The listing has to recurse now, which is the half that would silently
 * drop every nested route if it did not. */
describe('reading a pre-render directory back', () => {
	const directory = mkdtempSync(join(tmpdir(), 'absolute-prerender-paths-'));

	afterAll(() => rmSync(directory, { force: true, recursive: true }));

	test('a nested file rebuilds its own route', async () => {
		const routes = ['/', '/about', '/docs/guide', '/docs/guide/intro'];
		await Promise.all(
			routes.map((route) =>
				Bun.write(
					join(directory, routeToFilename(route)),
					'<html></html>'
				)
			)
		);
		// Sidecars the writer puts beside each page; the map must ignore
		// them.
		await Bun.write(join(directory, 'docs/guide.meta'), '0');

		const glob = new Bun.Glob('**/*.html');
		const found: string[] = [];
		for await (const file of glob.scan({ cwd: directory }))
			found.push(filenameToRoute(file));

		expect(found.sort()).toEqual(routes.sort());
	});
});
