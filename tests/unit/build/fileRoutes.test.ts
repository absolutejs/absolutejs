import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, sep } from 'node:path';
import {
	fileRouteFor,
	fileRouteNamed,
	fileRoutePageName,
	fileRoutePath,
	fileRoutesOf,
	isInFileRouteRoot,
	renderFileRouteModule,
	resolveFileRoutes,
	scanFileRoutes,
	syncFileRoutes
} from '../../../src/build/fileRoutes';

const roots: string[] = [];

const makeProject = async (files: Record<string, string>) => {
	const root = await mkdtemp(join(tmpdir(), 'absolutejs-file-routes-'));
	roots.push(root);
	await Promise.all(
		Object.entries(files).map(([path, contents]) =>
			Bun.write(join(root, path), contents)
		)
	);

	return root;
};

afterEach(async () => {
	await Promise.all(
		roots
			.splice(0)
			.map((root) => rm(root, { force: true, recursive: true }))
	);
	// Leave the process-wide registry empty for the next test file.
	scanFileRoutes({});
});

const toPosix = (path: string) => path.split(sep).join('/');

describe('fileRoutePath', () => {
	test('maps index, static and [param] segments to Elysia paths', () => {
		expect(fileRoutePath('react', 'index.tsx')).toEqual({
			paths: ['/'],
			typePath: '/'
		});
		expect(fileRoutePath('react', 'about.tsx')).toEqual({
			paths: ['/about'],
			typePath: '/about'
		});
		expect(fileRoutePath('react', 'blog/index.tsx')).toEqual({
			paths: ['/blog'],
			typePath: '/blog'
		});
		expect(fileRoutePath('react', 'blog/[slug].tsx')).toEqual({
			paths: ['/blog/:slug'],
			typePath: '/blog/:slug'
		});
		expect(fileRoutePath('svelte', '[org]/[repo]/issues.svelte')).toEqual({
			paths: ['/:org/:repo/issues'],
			typePath: '/:org/:repo/issues'
		});
	});

	/* A catch-all registers Elysia's `*` but types as the name the file
	 * gave it, because `params.rest` is what `docs/[...rest].tsx` led its
	 * `load` to expect. The two paths differing is the point. */
	test('maps a [...catchAll] to `*`, typed under its own name', () => {
		expect(fileRoutePath('react', 'docs/[...rest].tsx')).toEqual({
			catchAll: 'rest',
			paths: ['/docs/*'],
			typePath: '/docs/:rest'
		});
		expect(fileRoutePath('react', '[...all].tsx')).toEqual({
			catchAll: 'all',
			paths: ['/*'],
			typePath: '/:all'
		});
	});

	/* An optional segment is the only kind that makes one file serve more
	 * than one path, and the longer path comes first so the specific route
	 * is registered before the one it shadows. */
	test('expands [[optional]] segments into every path they serve', () => {
		expect(fileRoutePath('react', '[[lang]]/about.tsx')).toEqual({
			paths: ['/:lang/about', '/about'],
			typePath: '/:lang?/about'
		});
		expect(fileRoutePath('react', '[[lang]]/index.tsx')).toEqual({
			paths: ['/:lang', '/'],
			typePath: '/:lang?'
		});
		// Two of them multiply, rather than one of the four being dropped.
		expect(fileRoutePath('react', '[[a]]/[[b]]/x.tsx')).toEqual({
			paths: ['/:a/:b/x', '/:a/x', '/:b/x', '/x'],
			typePath: '/:a?/:b?/x'
		});
	});

	test('leaves a (group) out of the path', () => {
		expect(fileRoutePath('react', '(marketing)/pricing.tsx')).toEqual({
			paths: ['/pricing'],
			typePath: '/pricing'
		});
		expect(fileRoutePath('react', '(marketing)/index.tsx')).toEqual({
			paths: ['/'],
			typePath: '/'
		});
		// A group contributes nothing, so it cannot be nested into a param.
		expect(
			fileRoutePath('react', '(shop)/[category]/[item].tsx')
		).toEqual({
			paths: ['/:category/:item'],
			typePath: '/:category/:item'
		});
	});

	test('reports segments it cannot map, and says what is wrong', () => {
		const errorFor = (file: string) => {
			const result = fileRoutePath('react', file);

			return 'error' in result ? result.error : undefined;
		};

		// A catch-all matches the rest of the path, so nothing can follow it.
		expect(errorFor('docs/[...rest]/edit.tsx')).toContain(
			'has to be the last one'
		);
		// Named rather than reported as stray characters.
		expect(errorFor('[[...rest]]/index.tsx')).toContain(
			'optional catch-all'
		);
		// A group names a folder; as a file it would serve its parent's path.
		expect(errorFor('(marketing).tsx')).toContain('contributes no path');
		// Two params of one name would overwrite each other.
		expect(errorFor('[id]/x/[id].tsx')).toContain('both named "id"');
		expect(errorFor('[id]/[[id]]/x.tsx')).toContain('both named "id"');

		for (const file of ['[bad-name].tsx', 'a b.tsx', '[].tsx', '().tsx']) {
			expect(fileRoutePath('react', file)).toHaveProperty('error');
		}
	});
});

describe('fileRoutePageName', () => {
	test('is readable, letters and digits only, and unique per file', () => {
		const slug = fileRoutePageName('react', 'blog/[slug].tsx');
		const dashed = fileRoutePageName('react', 'blog-slug.tsx');
		const svelte = fileRoutePageName('svelte', 'blog/[slug].svelte');

		expect(slug).toMatch(/^RouteBlogSlug[0-9a-z]{6}$/);
		expect(dashed).toMatch(/^RouteBlogSlug[0-9a-z]{6}$/);
		expect(new Set([slug, dashed, svelte]).size).toBe(3);
		expect(fileRoutePageName('react', 'blog/[slug].tsx')).toBe(slug);
	});
});

describe('scanFileRoutes', () => {
	test('is off unless the config opts in', async () => {
		const root = await makeProject({ 'react/routes/index.tsx': '' });

		expect(resolveFileRoutes({ reactDirectory: 'react' }, root)).toBe(
			undefined
		);
	});

	test('finds route files, server modules and skips private files', async () => {
		const root = await makeProject({
			'react/routes/_parts/Shell.tsx': '',
			'react/routes/blog/[slug].server.ts': '',
			'react/routes/blog/[slug].tsx': '',
			'react/routes/blog/_Card.tsx': '',
			'react/routes/error.tsx': '',
			'react/routes/index.test.tsx': '',
			'react/routes/index.tsx': '',
			'svelte/routes/docs/index.svelte': ''
		});
		const cwd = process.cwd();
		process.chdir(root);
		// The real path (macOS tmpdir is a symlink): what the scan resolves.
		const base = process.cwd();
		try {
			const { problems, routes } = scanFileRoutes({
				fileRoutes: true,
				reactDirectory: 'react',
				svelteDirectory: 'svelte'
			});

			expect(problems).toEqual([]);
			expect(
				routes.map((route) => [route.framework, route.path])
			).toEqual([
				['react', '/'],
				['react', '/blog/:slug'],
				['svelte', '/docs']
			]);
			const post = routes.find((route) => route.path === '/blog/:slug');
			expect(post?.server).toEndWith('react/routes/blog/[slug].server.ts');
			expect(fileRoutesOf('svelte')).toHaveLength(1);
			expect(fileRouteNamed(post?.name ?? '')?.path).toBe('/blog/:slug');
			expect(
				fileRouteFor(join(base, 'react/routes/blog/[slug].tsx'))?.name
			).toBe(post?.name);
			expect(
				fileRouteFor(join(base, 'react/routes/blog/_Card.tsx'))
			).toBeUndefined();
			// A route created after the scan is still recognised by path.
			expect(
				fileRouteFor(join(base, 'react/routes/new.tsx'))?.path
			).toBe('/new');
			expect(isInFileRouteRoot(join(base, 'react/routes/x.ts'))).toBe(
				true
			);
			expect(isInFileRouteRoot(join(base, 'react/pages/x.tsx'))).toBe(
				false
			);
		} finally {
			process.chdir(cwd);
		}
	});

	test('reports two files that serve one path and unsupported segments', async () => {
		const root = await makeProject({
			'react/routes/about.tsx': '',
			'react/routes/docs/[...rest]/edit.tsx': '',
			'svelte/routes/about/index.svelte': ''
		});
		const cwd = process.cwd();
		process.chdir(root);
		try {
			const { problems, routes } = scanFileRoutes({
				fileRoutes: true,
				reactDirectory: 'react',
				svelteDirectory: 'svelte'
			});

			expect(routes.map((route) => route.path)).toEqual(['/about']);
			expect(problems).toHaveLength(2);
			expect(problems.join('\n')).toContain('both serve /about');
			expect(problems.join('\n')).toContain('has to be the last one');
		} finally {
			process.chdir(cwd);
		}
	});

	/* The scan's side of the segments: a catch-all and a group are single
	 * routes, an optional segment is two sharing one page name — the page
	 * is built once and registered twice. */
	test('scans catch-all, optional and group segments', async () => {
		const root = await makeProject({
			'react/routes/(marketing)/pricing.tsx': '',
			'react/routes/[[lang]]/about.tsx': '',
			'react/routes/docs/[...rest].tsx': ''
		});
		const cwd = process.cwd();
		process.chdir(root);
		try {
			const { problems, routes } = scanFileRoutes({
				fileRoutes: true,
				reactDirectory: 'react'
			});

			expect(problems).toEqual([]);
			expect(routes.map((route) => route.path).sort()).toEqual([
				'/:lang/about',
				'/about',
				'/docs/*',
				'/pricing'
			]);
			const optional = routes.filter((route) =>
				route.source.includes('[[lang]]')
			);
			expect(optional).toHaveLength(2);
			expect(new Set(optional.map((route) => route.name)).size).toBe(1);
			expect(optional.map((route) => route.typePath)).toEqual([
				'/:lang?/about',
				'/:lang?/about'
			]);
			expect(
				routes.find((route) => route.path === '/docs/*')?.catchAll
			).toBe('rest');
			// Nothing but the catch-all route carries the field.
			expect(
				routes.filter((route) => route.catchAll !== undefined)
			).toHaveLength(1);
		} finally {
			process.chdir(cwd);
		}
	});
});

describe('route module', () => {
	test('imports pages and server modules relative to the output', async () => {
		const root = await makeProject({
			'src/react/routes/blog/[slug].server.ts': '',
			'src/react/routes/blog/[slug].tsx': '',
			'src/svelte/routes/index.svelte': ''
		});
		const cwd = process.cwd();
		process.chdir(root);
		try {
			const result = syncFileRoutes({
				fileRoutes: { output: 'src/backend/routes.gen.ts' },
				reactDirectory: 'src/react',
				svelteDirectory: 'src/svelte'
			});
			const source = await readFile(
				join(root, 'src/backend/routes.gen.ts'),
				'utf-8'
			);

			expect(result?.written).toBe(true);
			expect(source).toContain(
				"import { reactFileRoute } from '@absolutejs/absolute/react/server';"
			);
			expect(source).toContain(
				"page: () => import('../react/routes/blog/[slug]'),"
			);
			expect(source).toContain(
				"typeof import('../react/routes/blog/[slug].server')"
			);
			expect(source).toContain(
				"typeof import('../svelte/routes/index.svelte'),"
			);
			// Svelte pages render from the manifest; no runtime import.
			expect(source).not.toContain(
				"() => import('../svelte/routes/index.svelte')"
			);
			// Unchanged routes leave the file alone (no watcher churn).
			expect(
				syncFileRoutes({
					fileRoutes: { output: 'src/backend/routes.gen.ts' },
					reactDirectory: 'src/react',
					svelteDirectory: 'src/svelte'
				})?.written
			).toBe(false);
		} finally {
			process.chdir(cwd);
		}
	});

	/* Vue routes render from the manifest like Svelte's, so the module
	 * imports the `.vue` source for its TYPE only — importing an SFC on the
	 * server is what the compiled module exists to avoid. */
	test('writes Vue routes against the Vue adapter', async () => {
		const root = await makeProject({
			'vue/routes/[[lang]]/profile.server.ts': '',
			'vue/routes/[[lang]]/profile.vue': ''
		});
		const cwd = process.cwd();
		process.chdir(root);
		try {
			syncFileRoutes({
				fileRoutes: { output: 'routes.gen.ts' },
				vueDirectory: 'vue'
			});
			const source = await readFile(join(root, 'routes.gen.ts'), 'utf-8');

			expect(source).toContain(
				"import { vueFileRoute } from '@absolutejs/absolute/vue/server';"
			);
			// The extension stays: it is part of an SFC's specifier.
			expect(source).toContain(
				"typeof import('./vue/routes/[[lang]]/profile.vue'),"
			);
			expect(source).not.toContain(
				"page: () => import('./vue/routes/[[lang]]/profile.vue')"
			);
			// Both paths of the optional segment, typed as one.
			expect(source).toContain("path: '/:lang/profile',");
			expect(source).toContain("path: '/profile',");
			expect(source).toContain("typePath: '/:lang?/profile'");
		} finally {
			process.chdir(cwd);
		}
	});

	/* An HTML or HTMX route is served as the file the build produced, with
	 * no props and no `load` — so a param would match a value the page
	 * cannot read, and every value would serve identical markup. A group
	 * still works: it contributes no segment. */
	test('writes HTML and HTMX routes, static segments only', async () => {
		const root = await makeProject({
			'html/routes/(site)/about.html': '',
			'html/routes/pricing/[tier].html': '',
			'htmx/routes/panel.html': ''
		});
		const cwd = process.cwd();
		process.chdir(root);
		try {
			const { problems, routes } = syncFileRoutes({
				fileRoutes: { output: 'routes.gen.ts' },
				htmlDirectory: 'html',
				htmxDirectory: 'htmx'
			}) ?? { problems: [], routes: [] };
			const source = await readFile(join(root, 'routes.gen.ts'), 'utf-8');

			expect(routes.map((route) => route.path).sort()).toEqual([
				'/about',
				'/panel'
			]);
			expect(problems.join('\n')).toContain('[tier]');
			expect(problems.join('\n')).toContain('static file with no props');
			expect(source).toContain(
				"import { htmlFileRoute, htmxFileRoute } from '@absolutejs/absolute';"
			);
			// Nothing is imported for the page: the build copies the file and
			// the manifest holds where it landed.
			expect(source).not.toContain("import('./html/routes");
		} finally {
			process.chdir(cwd);
		}
	});

	/* An Angular page takes no props: data reaches it as the page's
	 * request context, so a route's `load` returns that and the middle type
	 * argument is the page's `Context`. It is a type-only export, which
	 * `typeof import()` cannot see, so the page is typed with a
	 * type-level `import(page).Context` — and only when the page really
	 * exports one, since naming a type that is not there is a type error
	 * in the generated module. */
	test('types an Angular route against the page Context it exports', async () => {
		const root = await makeProject({
			'angular/routes/admin/[id].server.ts': '',
			'angular/routes/admin/[id].ts':
				'export type Context = { id: string };\n',
			'angular/routes/plain.ts': 'export class PlainComponent {}\n'
		});
		const cwd = process.cwd();
		process.chdir(root);
		try {
			syncFileRoutes({
				angularDirectory: 'angular',
				fileRoutes: { output: 'routes.gen.ts' }
			});
			const source = await readFile(join(root, 'routes.gen.ts'), 'utf-8');

			expect(source).toContain(
				"import { angularFileRoute } from '@absolutejs/absolute/angular/server';"
			);
			expect(source).toContain(
				"import('./angular/routes/admin/[id]').Context,"
			);
			// No `Context` export: permissive rather than a type error.
			expect(source).toContain('Record<string, unknown>,');
			// Angular renders from the manifest, so no page import.
			expect(source).not.toContain(
				"page: () => import('./angular/routes"
			);
		} finally {
			process.chdir(cwd);
		}
	});

	/* A `layout.<ext>` applies to its folder and everything below it, so a
	 * route's chain is every layout from the route root down to its own
	 * folder, outermost first. A `(group)` folder participates like any
	 * other, which is most of why groups are useful. */
	test('collects the layouts wrapping each route, outermost first', async () => {
		const root = await makeProject({
			'react/routes/(marketing)/layout.tsx': '',
			'react/routes/(marketing)/plans/layout.tsx': '',
			'react/routes/(marketing)/plans/pricing.tsx': '',
			'react/routes/blog/index.tsx': '',
			'react/routes/layout.tsx': ''
		});
		const cwd = process.cwd();
		process.chdir(root);
		try {
			const { problems, routes } = scanFileRoutes({
				fileRoutes: true,
				reactDirectory: 'react'
			});
			/* Relative to the RESOLVED cwd, not to `root`: on macOS
			 * `mkdtemp` hands back a `/var/...` path while `process.cwd()`
			 * reports `/private/var/...`, and the scanner's paths are
			 * built from the latter. */
			const layoutsOf = (path: string) =>
				(
					routes.find((route) => route.path === path)?.layouts ?? []
				).map((layout) => toPosix(relative(process.cwd(), layout)));

			expect(problems).toEqual([]);
			expect(layoutsOf('/plans/pricing')).toEqual([
				'react/routes/layout.tsx',
				'react/routes/(marketing)/layout.tsx',
				'react/routes/(marketing)/plans/layout.tsx'
			]);
			// A sibling branch gets only the layouts above it.
			expect(layoutsOf('/blog')).toEqual(['react/routes/layout.tsx']);
			// A layout is never itself a route.
			expect(routes.map((route) => route.path).sort()).toEqual([
				'/blog',
				'/plans/pricing'
			]);
		} finally {
			process.chdir(cwd);
		}
	});

	/* React, Svelte and Vue compose layouts; Angular, HTML and HTMX do
	 * not yet. A layout that cannot be applied is worse than no layout —
	 * the page renders without its chrome and nothing says so — so it is
	 * reported rather than ignored. */
	/* HTML, because a static page has nothing to compose a layout WITH —
	 * no component model and no render step. Angular used to be this
	 * test's example and now composes them like Svelte and Vue. */
	test('reports a layout in a framework that cannot apply it yet', async () => {
		const root = await makeProject({
			'html/routes/admin/index.html': '',
			'html/routes/admin/layout.html': ''
		});
		const cwd = process.cwd();
		process.chdir(root);
		try {
			const { problems, routes } = scanFileRoutes({
				fileRoutes: true,
				htmlDirectory: 'html'
			});

			expect(problems.join('\n')).toContain('layout.html');
			expect(problems.join('\n')).toContain(
				'applied to React, Svelte, Vue and Angular'
			);
			// The route itself still serves, without the layout.
			expect(routes.map((route) => route.path)).toEqual(['/admin']);
			expect(routes[0]?.layouts).toBeUndefined();
		} finally {
			process.chdir(cwd);
		}
	});

	test('collects an Angular route layout', async () => {
		const root = await makeProject({
			'angular/routes/admin/index.ts': '',
			'angular/routes/admin/layout.ts': '',
			'angular/routes/layout.ts': ''
		});
		const cwd = process.cwd();
		process.chdir(root);
		try {
			const { problems, routes } = scanFileRoutes({
				angularDirectory: 'angular',
				fileRoutes: true
			});

			expect(problems).toEqual([]);
			// Outermost first, which is the order the wrap depends on.
			expect(
				routes[0]?.layouts?.map((path) => basename(dirname(path)))
			).toEqual(['routes', 'admin']);
		} finally {
			process.chdir(cwd);
		}
	});

	/* And a Svelte layout is now collected rather than reported. */
	test('collects a Svelte route layout', async () => {
		const root = await makeProject({
			'svelte/routes/docs/index.svelte': '',
			'svelte/routes/docs/layout.svelte': ''
		});
		const cwd = process.cwd();
		process.chdir(root);
		try {
			const { problems, routes } = scanFileRoutes({
				fileRoutes: true,
				svelteDirectory: 'svelte'
			});

			expect(problems).toEqual([]);
			expect(
				(routes[0]?.layouts ?? []).map((layout) =>
					toPosix(relative(process.cwd(), layout))
				)
			).toEqual(['svelte/routes/docs/layout.svelte']);
		} finally {
			process.chdir(cwd);
		}
	});

	test('an app with no routes still exports an empty tree', () => {
		expect(renderFileRouteModule([], '/app/routes.gen.ts')).toContain(
			'export const routeTree: readonly FileRouteDefinition[] = [];'
		);
	});
});
