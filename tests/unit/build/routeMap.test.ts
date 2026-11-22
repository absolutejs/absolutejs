import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
	deriveRoutePaths,
	ROUTE_MAP_DECLARATION,
	routeMapDeclarationSource,
	writeRouteMapDeclaration
} from '../../../src/build/routeMap';

/* The route map that types `route()`, derived from the source tree the
 * way the manifest keys are — no build, so a path is checkable in a dev
 * server that builds lazily and in CI that only runs
 * `absolute typecheck`.
 *
 * The keys are TYPED paths, which is the distinction worth testing: a
 * `[...rest]` route registers as `/docs/*` and a caller has to write
 * `/docs/:rest`, because that is the name the file gave the param. */

const roots: string[] = [];

const makeProject = async (files: Record<string, string>) => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-route-map-'));
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
		roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
	);
});

const inProject = async <Result>(
	files: Record<string, string>,
	body: () => Result
) => {
	const root = await makeProject(files);
	const cwd = process.cwd();
	process.chdir(root);
	try {
		return { result: body(), root };
	} finally {
		process.chdir(cwd);
	}
};

describe('deriveRoutePaths', () => {
	test('reports the typed path of every route, sorted', async () => {
		const { result } = await inProject(
			{
				'react/routes/(marketing)/pricing.tsx': '',
				'react/routes/blog/[slug].tsx': '',
				'react/routes/docs/[...rest].tsx': '',
				'react/routes/index.tsx': '',
				'svelte/routes/[[lang]]/about.svelte': ''
			},
			() =>
				deriveRoutePaths({
					fileRoutes: true,
					reactDirectory: 'react',
					svelteDirectory: 'svelte'
				})
		);

		/* `/docs/:rest` not `/docs/*`, and `/:lang?/about` once rather
		 * than both of the paths that one file registers. */
		expect(result).toEqual([
			'/',
			'/:lang?/about',
			'/blog/:slug',
			'/docs/:rest',
			'/pricing'
		]);
	});

	test('a project with no file routes has none', async () => {
		const { result } = await inProject({ 'react/pages/Home.tsx': '' }, () =>
			deriveRoutePaths({ fileRoutes: true, reactDirectory: 'react' })
		);

		expect(result).toEqual([]);
	});
});

describe('routeMapDeclarationSource', () => {
	test('merges the paths into the package interface', () => {
		const source = routeMapDeclarationSource(['/blog/:slug', '/pricing']);

		expect(source).toContain("declare module '@absolutejs/absolute'");
		expect(source).toContain('interface AbsoluteRouteMap {');
		expect(source).toContain('"/blog/:slug": true;');
		expect(source).toContain('"/pricing": true;');
	});
});

describe('writeRouteMapDeclaration', () => {
	test('writes the declaration for a project with routes', async () => {
		const root = await makeProject({
			'react/routes/blog/[slug].tsx': ''
		});
		const written = await writeRouteMapDeclaration(
			{ fileRoutes: true, reactDirectory: 'react' },
			root
		);

		expect(written).toBe(join(root, ROUTE_MAP_DECLARATION));
		expect(await readFile(written ?? '', 'utf-8')).toContain(
			'"/blog/:slug": true;'
		);
	});

	/* No declaration rather than an empty one, so `route()` accepts any
	 * path in a project that has no file routes — which is what keeps this
	 * from breaking every existing app. */
	test('removes a stale declaration when the routes are gone', async () => {
		const root = await makeProject({ 'react/pages/Home.tsx': '' });
		const path = join(root, ROUTE_MAP_DECLARATION);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, '// stale\n');

		expect(
			await writeRouteMapDeclaration(
				{ fileRoutes: true, reactDirectory: 'react' },
				root
			)
		).toBeNull();
		expect(await readFile(path, 'utf-8').catch(() => null)).toBeNull();
	});
});
