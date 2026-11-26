import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test
} from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPrerenderLookup } from '../../../src/core/prerenderLookup';

/* The lookup that decides which pre-rendered file answers a request,
 * when the list in memory and the files on disk disagree — which is the
 * normal state of a clustered server, where each worker has its own
 * list and they share one directory. "Another worker" below is the test
 * writing or deleting a file behind the lookup's back. */

let root = '';
let prerenderDir = '';
let routes = new Map<string, string>();

const live = (name: string) => join(prerenderDir, name);
const covered = (route: string) =>
	route.startsWith('/blog/') || route === '/blog';

const lookup = (canCreate = covered) =>
	createPrerenderLookup({ canCreate, prerenderDir, routes });

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), 'absolute-prerender-lookup-'));
	prerenderDir = join(root, '_prerendered');
});

beforeEach(async () => {
	await rm(prerenderDir, { force: true, recursive: true });
	await mkdir(join(prerenderDir, 'blog'), { recursive: true });
	await writeFile(live('blog/hello.html'), 'hello');
	await writeFile(join(root, 'secret.html'), 'outside');
	routes = new Map([['/blog/hello', live('blog/hello.html')]]);
});

afterAll(() => rm(root, { force: true, recursive: true }));

describe('a route the list knows', () => {
	test('is served from its file', () => {
		expect(lookup().fileFor('/blog/hello')).toBe(live('blog/hello.html'));
	});

	/* Answering with a file that is gone is a 500. The page was taken
	 * down, so the request is rendered instead, and the route is
	 * forgotten so the next request does not ask the disk again. */
	test('is dropped, and rendered, once another worker has taken its page down', async () => {
		const prerendered = lookup();
		await rm(live('blog/hello.html'));

		expect(prerendered.fileFor('/blog/hello')).toBeUndefined();
		expect(routes.has('/blog/hello')).toBe(false);
	});
});

describe('a route the list does not know', () => {
	test('is adopted when another worker has created its page', async () => {
		const prerendered = lookup();
		expect(prerendered.fileFor('/blog/new-post')).toBeUndefined();

		await writeFile(live('blog/new-post.html'), 'new');

		expect(prerendered.fileFor('/blog/new-post')).toBe(
			live('blog/new-post.html')
		);
		expect(routes.get('/blog/new-post')).toBe(live('blog/new-post.html'));
	});

	test('comes back after being taken down and published again', async () => {
		const prerendered = lookup();
		await rm(live('blog/hello.html'));
		expect(prerendered.fileFor('/blog/hello')).toBeUndefined();

		await writeFile(live('blog/hello.html'), 'again');

		expect(prerendered.fileFor('/blog/hello')).toBe(
			live('blog/hello.html')
		);
	});

	/* A file being there is not enough: the config says which paths are
	 * static, and a stray file must not become a page by existing. */
	test('is not adopted for a path the config does not cover', async () => {
		await mkdir(join(prerenderDir, 'admin'), { recursive: true });
		await writeFile(live('admin/panel.html'), 'stray');

		expect(lookup().fileFor('/admin/panel')).toBeUndefined();
	});

	/* Under `routes: 'all'` every path is covered. A request for an
	 * asset must not go looking for a page, and must never be answered
	 * with one. */
	test('is not looked for when the path is a file, not a page', async () => {
		await writeFile(live('blog/app.js.html'), 'not a page');

		expect(lookup(() => true).fileFor('/blog/app.js')).toBeUndefined();
	});

	test('is never a file outside the pre-render directory', () => {
		const prerendered = lookup(() => true);

		expect(prerendered.fileFor('/../secret')).toBeUndefined();
		expect(prerendered.fileFor('/blog/../../secret')).toBeUndefined();
		expect(prerendered.has('/../secret')).toBe(false);
	});
});

describe('whether a route has a page to take down', () => {
	test('yes for a listed route', () => {
		expect(lookup().has('/blog/hello')).toBe(true);
	});

	/* Created by one worker, deleted through another: the second has
	 * never heard of the page and must still be able to remove it. */
	test('yes for a page only the disk knows about', async () => {
		await writeFile(live('blog/elsewhere.html'), 'by another worker');

		expect(lookup().has('/blog/elsewhere')).toBe(true);
	});

	test('no when there is neither', () => {
		expect(lookup().has('/blog/never')).toBe(false);
	});
});
