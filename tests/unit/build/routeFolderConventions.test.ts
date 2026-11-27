import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import type { BuildConfig } from '../../../types/build';
import { fileRoutesOf, scanFileRoutes } from '../../../src/build/fileRoutes';
import { scanRouteFolderConventions } from '../../../src/build/routeFolderConventions';

/* `error` and `not-found` files in a route folder, as the build finds
 * them: which one each route gets, and which addresses a folder's
 * `not-found` stands for. The route folder below is real, because the
 * thing under test is a walk up a directory tree. */

const REPO_ROOT = resolve(import.meta.dir, '../../..');
const PAGE = 'export default function Page() {\n\treturn null;\n}\n';

const FILES = [
	'react/routes/index.tsx',
	'react/routes/error.tsx',
	'react/routes/blog/index.tsx',
	'react/routes/blog/[slug].tsx',
	'react/routes/blog/error.tsx',
	'react/routes/blog/not-found.tsx',
	'react/routes/blog/drafts/list.tsx',
	'react/routes/blog/drafts/error.tsx',
	'react/routes/users/[id]/profile.tsx',
	'react/routes/users/[id]/not-found.tsx',
	'react/routes/(admin)/panel.tsx',
	'react/routes/(admin)/not-found.tsx',
	'react/routes/[[lang]]/about.tsx',
	'react/routes/[[lang]]/not-found.tsx',
	'react/routes/_parts/not-found.tsx',
	'react/routes/shop/item.tsx',
	// A page's own error file is not a folder's.
	'react/routes/shop/item.error.tsx'
];

const CONFIG: BuildConfig = { fileRoutes: true, reactDirectory: 'react' };

let project = '';

beforeAll(async () => {
	const parent = join(REPO_ROOT, '.test-builds');
	await mkdir(parent, { recursive: true });
	project = await mkdtemp(join(parent, 'route-folder-conventions-'));
	await Promise.all(
		FILES.map((path) => Bun.write(join(project, path), PAGE))
	);
	scanFileRoutes(CONFIG, project);
});

afterAll(async () => {
	// Leave the process-wide registry empty for the next test file.
	scanFileRoutes({});
	await rm(project, { force: true, recursive: true });
});

const inRoutes = (file: string | undefined) =>
	file === undefined
		? undefined
		: relative(join(project, 'react', 'routes'), file).replace(/\\/g, '/');

const scanned = async () => {
	const result = await scanRouteFolderConventions('react');
	if (!result) throw new Error('expected route folder conventions');

	return result;
};

/* What the route serving `path` was given. */
const forRoute = async (path: string) => {
	const route = fileRoutesOf('react').find(
		(candidate) => candidate.path === path
	);
	if (!route) throw new Error(`no route for ${path}`);
	const found = (await scanned()).routes[route.name];

	return {
		error: inRoutes(found?.error),
		notFound: inRoutes(found?.notFound)
	};
};

describe('the conventions a route is given', () => {
	test('are the ones in its own folder', async () => {
		expect(await forRoute('/blog/:slug')).toEqual({
			error: 'blog/error.tsx',
			notFound: 'blog/not-found.tsx'
		});
	});

	/* `drafts/` has an error page and no not-found. */
	test('are the nearest above it, each kind found on its own', async () => {
		expect(await forRoute('/blog/drafts/list')).toEqual({
			error: 'blog/drafts/error.tsx',
			notFound: 'blog/not-found.tsx'
		});
	});

	test('reach up to the route root', async () => {
		expect(await forRoute('/shop/item')).toEqual({
			error: 'error.tsx',
			notFound: undefined
		});
	});

	test('include a (group) folder’s, for the group’s routes only', async () => {
		expect((await forRoute('/panel')).notFound).toBe(
			'(admin)/not-found.tsx'
		);
		expect((await forRoute('/')).notFound).toBeUndefined();
	});

	/* An [[optional]] route serves two paths under one page name, and
	 * conventions are kept by page name: both paths get the same. */
	test('are one set for an [[optional]] route, whichever path is asked for', async () => {
		const route = fileRoutesOf('react').find((candidate) =>
			candidate.source.endsWith(join('[[lang]]', 'about.tsx'))
		);
		const found = (await scanned()).routes[route?.name ?? ''];

		expect(inRoutes(found?.notFound)).toBe('[[lang]]/not-found.tsx');
	});
});

describe('the addresses a folder’s not-found stands for', () => {
	const paths = async () =>
		(await scanned()).folders.map((folder) => folder.path);

	test('are the folder’s, as its routes are addressed', async () => {
		const found = await paths();

		expect(found).toContain('/blog');
		expect(found).toContain('/users/:id');
	});

	test('are both paths of an [[optional]] folder', async () => {
		const folders = (await scanned()).folders.filter(
			(folder) => inRoutes(folder.notFound) === '[[lang]]/not-found.tsx'
		);

		expect(folders.map((folder) => folder.path).sort()).toEqual([
			'/',
			'/:lang'
		]);
	});

	/* A group adds nothing to an address, so its not-found has no path
	 * of its own to answer for; a private folder is not routing at all. */
	test('leave out a (group) folder and a private one', async () => {
		const files = (await scanned()).folders.map((folder) =>
			inRoutes(folder.notFound)
		);

		expect(files).not.toContain('(admin)/not-found.tsx');
		expect(files).not.toContain('_parts/not-found.tsx');
	});
});

describe('a framework with no route folder', () => {
	test('has none', async () => {
		expect(await scanRouteFolderConventions('vue')).toBeUndefined();
	});
});
