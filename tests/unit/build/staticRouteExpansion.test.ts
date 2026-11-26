import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { BuildConfig } from '../../../types/build';
import { scanFileRoutes } from '../../../src/build/fileRoutes';
import { expandStaticRoutes } from '../../../src/build/staticRouteExpansion';

/* `static.routes` patterns, from route files on disk to the list of
 * pages a pre-render pass is given. The route folder below is real —
 * the scanner reads it and each server module's `entries()` is imported
 * and run — because the thing under test is the join between the three:
 * a pattern, the file route it names, and what that route says it
 * serves. */

const REPO_ROOT = resolve(import.meta.dir, '../../..');
const PAGE = 'export default function Page() {\n\treturn null;\n}\n';

const FILES: Record<string, string> = {
	'react/routes/about.tsx': PAGE,
	'react/routes/blog/[slug].server.ts':
		"export const entries = () => [{ slug: 'hello' }, { slug: 'a b' }, { slug: 'hello' }];\n",
	'react/routes/blog/[slug].tsx': PAGE,
	'react/routes/broken/[id].server.ts':
		"export const entries = () => {\n\tthrow new Error('database is unreachable');\n};\n",
	'react/routes/broken/[id].tsx': PAGE,
	'react/routes/docs/[...rest].server.ts':
		"export const entries = async () => [{ rest: 'guide/routing' }];\n",
	'react/routes/docs/[...rest].tsx': PAGE,
	'react/routes/guides/[topic].server.ts':
		"export const entries = () => [{ topic: 'routing' }, { topic: 'data' }];\n",
	'react/routes/guides/[topic].tsx': PAGE,
	'react/routes/guides/deep/setup.tsx': PAGE,
	'react/routes/guides/drafts/[id].tsx': PAGE,
	'react/routes/guides/index.tsx': PAGE,
	'react/routes/guides/intro.tsx': PAGE,
	// Beside the folder, not in it: its path only starts the same way.
	'react/routes/guidesplus.tsx': PAGE,
	'react/routes/items/[id].server.ts':
		'export const entries = () => [{ id: 7 }, { name: "no id" }, "nonsense"];\n',
	'react/routes/items/[id].tsx': PAGE,
	'react/routes/odd/[id].server.ts':
		"export const entries = () => 'not a list';\n",
	'react/routes/odd/[id].tsx': PAGE,
	'react/routes/plain/[id].server.ts': 'export const load = () => ({});\n',
	'react/routes/plain/[id].tsx': PAGE,
	'react/routes/shop/[[category]].server.ts':
		"export const entries = () => [{ category: 'hats' }, {}];\n",
	'react/routes/shop/[[category]].tsx': PAGE,
	'react/routes/users/[id].tsx': PAGE
};

const CONFIG: BuildConfig = { fileRoutes: true, reactDirectory: 'react' };

let project = '';

beforeAll(async () => {
	const parent = join(REPO_ROOT, '.test-builds');
	await mkdir(parent, { recursive: true });
	project = await mkdtemp(join(parent, 'static-route-expansion-'));
	await Promise.all(
		Object.entries(FILES).map(([path, contents]) =>
			Bun.write(join(project, path), contents)
		)
	);
});

afterAll(async () => {
	// Leave the process-wide registry empty for the next test file.
	scanFileRoutes({});
	await rm(project, { force: true, recursive: true });
});

const expand = (listed: string[]) =>
	expandStaticRoutes(CONFIG, listed, project);

describe('a pattern in static.routes', () => {
	test('becomes one page per param set its route’s entries() returns', async () => {
		const { failures, routes } = await expand(['/blog/:slug']);

		expect(failures).toEqual([]);
		// Encoded as a URL, and a set returned twice is one page.
		expect(routes).toEqual(['/blog/hello', '/blog/a%20b']);
	});

	test('keeps literal paths as written, in their place', async () => {
		const { routes } = await expand(['/', '/blog/:slug', '/about']);

		expect(routes).toEqual(['/', '/blog/hello', '/blog/a%20b', '/about']);
	});

	test('fills a catch-all with its slashes, under the name the file gave it', async () => {
		const { failures, routes } = await expand(['/docs/:rest']);

		expect(failures).toEqual([]);
		expect(routes).toEqual(['/docs/guide/routing']);
	});

	/* `/docs/*` is what Elysia registers for `[...rest]`, and what
	 * `absolute routes` prints, so it is what someone will copy. */
	test('accepts the path as the server registers it', async () => {
		const { routes } = await expand(['/docs/*']);

		expect(routes).toEqual(['/docs/guide/routing']);
	});

	test('an optional segment yields the path with it and the path without', async () => {
		const { failures, routes } = await expand(['/shop/:category?']);

		expect(failures).toEqual([]);
		expect(routes).toEqual(['/shop/hats', '/shop']);
	});

	test('a list with no pattern is returned untouched', async () => {
		expect(await expand(['/', '/about', '/not-a-route'])).toEqual({
			failures: [],
			routes: ['/', '/about', '/not-a-route']
		});
	});
});

describe('a folder in static.routes', () => {
	test('is its index, its static routes, and its dynamic ones through entries()', async () => {
		const { routes } = await expand(['/guides/*']);

		expect([...routes].sort()).toEqual([
			'/guides',
			'/guides/data',
			'/guides/deep/setup',
			'/guides/intro',
			'/guides/routing'
		]);
	});

	test('stops at the folder: a sibling whose path starts the same is not in it', async () => {
		const { routes } = await expand(['/guides/*']);

		expect(routes).not.toContain('/guidesplus');
	});

	/* "Everything under /guides" that quietly left a route out is the
	 * failure this exists to prevent, so the route that cannot be
	 * enumerated is named — under its own path, since the config never
	 * wrote it. */
	test('names a dynamic route in it that cannot be enumerated', async () => {
		const { failures } = await expand(['/guides/*']);

		expect(failures).toHaveLength(1);
		expect(failures[0]?.route).toBe('/guides/drafts/:id');
		expect(failures[0]?.reason).toContain('has no server module');
	});

	test('a folder holding only a catch-all is that route’s pages', async () => {
		const { failures, routes } = await expand(['/docs/*']);

		expect(failures).toEqual([]);
		expect(routes).toEqual(['/docs/guide/routing']);
	});

	test('`/*` is every file route', async () => {
		const { routes } = await expand(['/*']);

		expect(routes).toContain('/about');
		expect(routes).toContain('/guidesplus');
		expect(routes).toContain('/guides');
		expect(routes).toContain('/blog/hello');
		expect(routes).toContain('/shop');
	});

	/* An [[optional]] route registers two paths sharing one typed path;
	 * the folder reaches it twice and must say what it has to say once. */
	test('reports a route’s failure once, however many paths it registers', async () => {
		const { failures, routes } = await expand(['/shop/*']);

		expect(failures).toEqual([]);
		expect([...routes].sort()).toEqual(['/shop', '/shop/hats']);
	});

	test('a folder no file route is in is reported', async () => {
		const { failures, routes } = await expand(['/nowhere/*']);

		expect(routes).toEqual([]);
		expect(failures[0]?.route).toBe('/nowhere/*');
		expect(failures[0]?.reason).toContain(
			'no file route is under this path'
		);
	});

	test('sits in a list with literal paths and patterns, without repeats', async () => {
		const { routes } = await expand([
			'/about',
			'/guides/*',
			'/guides/intro',
			'/blog/:slug'
		]);

		expect(
			routes.filter((route) => route === '/guides/intro')
		).toHaveLength(1);
		expect(routes[0]).toBe('/about');
		expect(routes).toContain('/blog/hello');
	});
});

describe('a pattern that cannot become pages is reported, not skipped', () => {
	const reasonFor = async (pattern: string) => {
		const { failures, routes } = await expand([pattern]);

		expect(routes).toEqual([]);
		expect(failures).toHaveLength(1);
		expect(failures[0]?.route).toBe(pattern);

		return failures[0]?.reason ?? '';
	};

	test('no file route has that path', async () => {
		expect(await reasonFor('/nowhere/:id')).toContain(
			'no file route has this path'
		);
	});

	test('the route has no server module', async () => {
		const reason = await reasonFor('/users/:id');

		expect(reason).toContain('has no server module');
		expect(reason).toContain('users/[id].tsx');
	});

	test('the server module does not export entries()', async () => {
		expect(await reasonFor('/plain/:id')).toContain(
			'does not export entries()'
		);
	});

	test('entries() threw', async () => {
		const reason = await reasonFor('/broken/:id');

		expect(reason).toContain('could not be run');
		expect(reason).toContain('database is unreachable');
	});

	test('entries() did not return a list', async () => {
		expect(await reasonFor('/odd/:id')).toContain(
			'did not return an array'
		);
	});

	/* One bad set costs that page, not the route: the good ones are
	 * still pre-rendered, and each bad one is named. */
	test('a set missing a param, or not a set at all, costs only itself', async () => {
		const { failures, routes } = await expand(['/items/:id']);

		expect(routes).toEqual(['/items/7']);
		expect(failures.map((failure) => failure.reason)).toEqual([
			expect.stringContaining('a set without "id"'),
			expect.stringContaining('not a set of params')
		]);
	});

	test('one failing pattern does not stop the others', async () => {
		const { failures, routes } = await expand([
			'/about',
			'/broken/:id',
			'/blog/:slug'
		]);

		expect(routes).toEqual(['/about', '/blog/hello', '/blog/a%20b']);
		expect(failures.map((failure) => failure.route)).toEqual([
			'/broken/:id'
		]);
	});
});
