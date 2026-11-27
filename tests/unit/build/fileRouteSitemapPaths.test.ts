import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileRouteSitemapPaths } from '../../../src/build/fileRouteSitemapPaths';
import { generateSitemap } from '../../../src/utils/generateSitemap';
import type { BuildConfig } from '../../../types/build';

/* The sitemap was EMPTY for a project whose pages are all file routes —
 * measured on the file-routes fixture: 20-odd routes and
 * `<urlset></urlset>`. It is built from a static scan of the project's
 * Elysia registrations, and a file route is not one: `fileRoutes()`
 * registers it at run time from the generated module, so nothing in the
 * source looks like `.get('/blog/:slug', …)`.
 *
 * A static route is its own URL. A dynamic one is enumerated by its
 * server module's `entries()`, or left out — a sitemap missing a URL is a
 * worse sitemap, but one containing `/blog/:slug` is a broken one. */

const roots: string[] = [];

const makeProject = async (files: Record<string, string>) => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-sitemap-paths-'));
	roots.push(root);
	await Promise.all(
		Object.entries(files).map(async ([path, contents]) => {
			await mkdir(dirname(join(root, path)), { recursive: true });
			await writeFile(join(root, path), contents);
		})
	);

	return root;
};

afterEach(async () => {
	await Promise.all(
		roots
			.splice(0)
			.map((root) => rm(root, { force: true, recursive: true }))
	);
});

const config: BuildConfig = { fileRoutes: true, reactDirectory: 'react' };

describe('fileRouteSitemapPaths', () => {
	test('lists a static route and skips a dynamic one with nothing to enumerate', async () => {
		const root = await makeProject({
			'react/routes/blog/[slug].tsx': 'export default () => null;',
			'react/routes/index.tsx': 'export default () => null;',
			'react/routes/pricing.tsx': 'export default () => null;'
		});

		expect(await fileRouteSitemapPaths(config, root)).toEqual([
			'/',
			'/pricing'
		]);
	});

	test('expands a dynamic route through entries()', async () => {
		const root = await makeProject({
			'react/routes/blog/[slug].server.ts':
				"export const entries = () => [{ slug: 'hello' }, { slug: 'world' }];",
			'react/routes/blog/[slug].tsx': 'export default () => null;'
		});

		expect(await fileRouteSitemapPaths(config, root)).toEqual([
			'/blog/hello',
			'/blog/world'
		]);
	});

	/* A catch-all's value IS a path, so its slashes survive — the same
	 * rule `route()` follows, from the same filler. */
	test('keeps the slashes in a catch-all entry', async () => {
		const root = await makeProject({
			'react/routes/docs/[...rest].server.ts':
				"export const entries = () => [{ rest: 'guide/routing' }];",
			'react/routes/docs/[...rest].tsx': 'export default () => null;'
		});

		expect(await fileRouteSitemapPaths(config, root)).toEqual([
			'/docs/guide/routing'
		]);
	});

	test('an optional segment serves both of its paths', async () => {
		const root = await makeProject({
			'react/routes/[[lang]]/about.server.ts':
				"export const entries = () => [{ lang: 'fr' }, { lang: undefined }];",
			'react/routes/[[lang]]/about.tsx': 'export default () => null;'
		});

		expect(await fileRouteSitemapPaths(config, root)).toEqual([
			'/about',
			'/fr/about'
		]);
	});

	test('accepts a number param', async () => {
		const root = await makeProject({
			'react/routes/posts/[id].server.ts':
				'export const entries = () => [{ id: 7 }];',
			'react/routes/posts/[id].tsx': 'export default () => null;'
		});

		expect(await fileRouteSitemapPaths(config, root)).toEqual(['/posts/7']);
	});

	/* One warning and the rest of the sitemap, not a failed build: the
	 * module runs in the build's process and may read a database. */
	test('an entries() that throws costs only its own route', async () => {
		const root = await makeProject({
			'react/routes/blog/[slug].server.ts':
				"export const entries = () => { throw new Error('db down'); };",
			'react/routes/blog/[slug].tsx': 'export default () => null;',
			'react/routes/pricing.tsx': 'export default () => null;'
		});

		expect(await fileRouteSitemapPaths(config, root)).toEqual(['/pricing']);
	});

	test('an entry missing a param is skipped, the rest kept', async () => {
		const root = await makeProject({
			'react/routes/blog/[slug].server.ts':
				"export const entries = () => [{ slug: 'kept' }, {}];",
			'react/routes/blog/[slug].tsx': 'export default () => null;'
		});

		expect(await fileRouteSitemapPaths(config, root)).toEqual([
			'/blog/kept'
		]);
	});

	test('a server module without entries() leaves its route out', async () => {
		const root = await makeProject({
			'react/routes/blog/[slug].server.ts':
				'export const load = () => ({ title: 1 });',
			'react/routes/blog/[slug].tsx': 'export default () => null;'
		});

		expect(await fileRouteSitemapPaths(config, root)).toEqual([]);
	});
});

/* A sitemap is the list of pages a site wants found. A route whose
 * metadata says `robots: { index: false }` asks for the opposite. */
describe('a route that asks not to be indexed', () => {
	const PAGE = 'export default () => null;';
	const NOINDEX =
		'export const metadata = { robots: { index: false }, title: "Account" };';

	test('is left out of the sitemap', async () => {
		const root = await makeProject({
			'react/routes/account.server.ts': NOINDEX,
			'react/routes/account.tsx': PAGE,
			'react/routes/pricing.server.ts':
				'export const metadata = { title: "Pricing" };',
			'react/routes/pricing.tsx': PAGE
		});

		expect(await fileRouteSitemapPaths(config, root)).toEqual(['/pricing']);
	});

	test('by a folder above it, is left out with everything in that folder', async () => {
		const root = await makeProject({
			'react/routes/admin/layout.server.ts': NOINDEX,
			'react/routes/admin/reports.tsx': PAGE,
			'react/routes/admin/users.tsx': PAGE,
			'react/routes/index.tsx': PAGE
		});

		expect(await fileRouteSitemapPaths(config, root)).toEqual(['/']);
	});

	/* Merged as they are for the page: nearer over farther. */
	test('and a route that says it is indexable, under such a folder, is listed', async () => {
		const root = await makeProject({
			'react/routes/admin/layout.server.ts': NOINDEX,
			'react/routes/admin/status.server.ts':
				'export const metadata = { robots: { index: true } };',
			'react/routes/admin/status.tsx': PAGE,
			'react/routes/admin/users.tsx': PAGE
		});

		expect(await fileRouteSitemapPaths(config, root)).toEqual([
			'/admin/status'
		]);
	});

	test('leaves out every page of a dynamic route', async () => {
		const root = await makeProject({
			'react/routes/drafts/[id].server.ts': `${NOINDEX}\nexport const entries = () => [{ id: '1' }, { id: '2' }];`,
			'react/routes/drafts/[id].tsx': PAGE
		});

		expect(await fileRouteSitemapPaths(config, root)).toEqual([]);
	});

	/* Worked out per request, from data a build does not have. */
	test('through a function is not known to a build, and stays', async () => {
		const root = await makeProject({
			'react/routes/post.server.ts':
				'export const metadata = () => ({ robots: { index: false } });',
			'react/routes/post.tsx': PAGE
		});

		expect(await fileRouteSitemapPaths(config, root)).toEqual(['/post']);
	});

	test('a server module with no metadata is not imported for it', async () => {
		const root = await makeProject({
			'react/routes/plain.server.ts':
				"throw new Error('imported for no reason');",
			'react/routes/plain.tsx': PAGE
		});

		expect(await fileRouteSitemapPaths(config, root)).toEqual(['/plain']);
	});

	test('a module that cannot be imported costs a warning, not the route', async () => {
		const root = await makeProject({
			'react/routes/broken.server.ts':
				"export const metadata = { title: 'x' };\nthrow new Error('at import');",
			'react/routes/broken.tsx': PAGE
		});
		const logged: string[] = [];
		const original = console.log;
		console.log = (...parts: unknown[]) => {
			logged.push(parts.map(String).join(' '));
		};
		try {
			expect(await fileRouteSitemapPaths(config, root)).toEqual([
				'/broken'
			]);
		} finally {
			console.log = original;
		}
		expect(logged.join('\n')).toContain('to read its metadata');
	});
});

describe('generateSitemap with file-route paths', () => {
	const outDir = mkdtempSync(join(tmpdir(), 'absolute-sitemap-file-routes-'));
	const read = () => readFileSync(join(outDir, 'sitemap.xml'), 'utf-8');
	const explicit = (path: string) => ({
		handlerSource: `.get('${path}', () => handleReactPageRequest({ Page }))`,
		method: 'GET',
		path
	});

	afterEach(() => rmSync(join(outDir, 'sitemap.xml'), { force: true }));

	test('lists them beside the scanned routes, once each', async () => {
		await generateSitemap(
			[explicit('/about'), explicit('/pricing')],
			'https://e.com',
			outDir,
			{},
			{ fileRoutePaths: ['/blog/hello', '/pricing'] }
		);
		const xml = read();

		expect(xml).toContain('<loc>https://e.com/blog/hello</loc>');
		expect(xml).toContain('<loc>https://e.com/about</loc>');
		// Served by both a file route and an explicit route: listed once.
		expect(xml.split('https://e.com/pricing<').length - 1).toBe(1);
	});

	test('an excluded path stays out however it is served', async () => {
		await generateSitemap(
			[],
			'https://e.com',
			outDir,
			{
				exclude: ['/draft']
			},
			{ fileRoutePaths: ['/draft', '/kept'] }
		);
		const xml = read();

		expect(xml).not.toContain('/draft');
		expect(xml).toContain('<loc>https://e.com/kept</loc>');
	});
});
