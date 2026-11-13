import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

describe('fileRoutePath', () => {
	test('maps index, static and [param] segments to Elysia paths', () => {
		expect(fileRoutePath('react', 'index.tsx')).toEqual({ path: '/' });
		expect(fileRoutePath('react', 'about.tsx')).toEqual({ path: '/about' });
		expect(fileRoutePath('react', 'blog/index.tsx')).toEqual({
			path: '/blog'
		});
		expect(fileRoutePath('react', 'blog/[slug].tsx')).toEqual({
			path: '/blog/:slug'
		});
		expect(fileRoutePath('svelte', '[org]/[repo]/issues.svelte')).toEqual({
			path: '/:org/:repo/issues'
		});
	});

	test('reports segments Phase 1 does not support', () => {
		for (const file of [
			'docs/[...rest].tsx',
			'[[lang]]/index.tsx',
			'(marketing)/pricing.tsx',
			'[bad-name].tsx',
			'a b.tsx'
		]) {
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
			'react/routes/docs/[...rest].tsx': '',
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
			expect(problems.join('\n')).toContain('[...rest]');
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

	test('an app with no routes still exports an empty tree', () => {
		expect(renderFileRouteModule([], '/app/routes.gen.ts')).toContain(
			'export const routeTree: readonly FileRouteDefinition[] = [];'
		);
	});
});
