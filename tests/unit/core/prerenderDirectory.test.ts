import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test
} from 'bun:test';
import { chmodSync, existsSync, readdirSync, utimesSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	prerenderBuildId,
	prerenderDirectoryProblem,
	resolvePrerenderDirectory,
	usablePrerenderDirectory
} from '../../../src/core/prerenderDirectory';

/* `static.directory`: pre-rendered pages kept outside the build, in a
 * folder per build. "A build" here is a directory with a manifest and a
 * `_prerendered/` of pages, which is all the code under test reads. */

let root = '';
let shared = '';

type Build = {
	manifest?: string;
	pages?: Record<string, string>;
	renderedAt?: string;
};

const makeBuild = async (
	name: string,
	{
		manifest = '{"Home":"/home.abc.js"}',
		pages = {},
		renderedAt = '1000'
	}: Build = {}
) => {
	const buildDir = join(root, name);
	await mkdir(join(buildDir, '_prerendered'), { recursive: true });
	await writeFile(join(buildDir, 'manifest.json'), manifest);
	await Promise.all(
		Object.entries(pages).flatMap(([page, html]) => {
			const file = join(buildDir, '_prerendered', page);

			return [
				mkdir(join(file, '..'), { recursive: true }).then(() =>
					writeFile(`${file}.html`, html)
				),
				mkdir(join(file, '..'), { recursive: true }).then(() =>
					writeFile(`${file}.meta`, renderedAt)
				)
			];
		})
	);

	return buildDir;
};

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), 'absolute-prerender-directory-'));
});

beforeEach(async () => {
	shared = join(root, `shared-${crypto.randomUUID()}`);
});

afterAll(() => rm(root, { force: true, recursive: true }));

describe('without static.directory', () => {
	test('pages stay in the build, and nothing else is created', async () => {
		const buildDir = await makeBuild('plain', { pages: { index: 'HOME' } });

		expect(resolvePrerenderDirectory(buildDir, undefined)).toBe(
			join(buildDir, '_prerendered')
		);
		expect(resolvePrerenderDirectory(buildDir, '')).toBe(
			join(buildDir, '_prerendered')
		);
		expect(existsSync(shared)).toBe(false);
	});
});

describe('with static.directory', () => {
	test('serves from this build’s own folder, filled from the build', async () => {
		const buildDir = await makeBuild('seeded', {
			pages: { 'blog/hello': 'HELLO', index: 'HOME' }
		});

		const live = resolvePrerenderDirectory(buildDir, shared);

		expect(live).toBe(join(shared, prerenderBuildId(buildDir)));
		expect(await readFile(join(live, 'index.html'), 'utf-8')).toBe('HOME');
		expect(await readFile(join(live, 'blog/hello.html'), 'utf-8')).toBe(
			'HELLO'
		);
		// Sidecars come too: a page without its timestamp or nonce is
		// not the page the build made.
		expect(existsSync(join(live, 'blog/hello.meta'))).toBe(true);
	});

	/* The reason pages are kept outside the build at all: what the
	 * server re-rendered must survive the server restarting. */
	test('a restart keeps a page revalidated since the build', async () => {
		const buildDir = await makeBuild('restart', {
			pages: { index: 'BUILT' }
		});
		const live = resolvePrerenderDirectory(buildDir, shared);
		await writeFile(join(live, 'index.html'), 'REVALIDATED');
		await writeFile(join(live, 'created-later.html'), 'CREATED');

		const again = resolvePrerenderDirectory(buildDir, shared);

		expect(again).toBe(live);
		expect(await readFile(join(again, 'index.html'), 'utf-8')).toBe(
			'REVALIDATED'
		);
		expect(existsSync(join(again, 'created-later.html'))).toBe(true);
	});

	/* A page names the hashed assets of the build that rendered it. One
	 * left over from the build before would ask for files this build
	 * does not have. */
	test('the next build gets a folder of its own, with none of the last one’s pages', async () => {
		const first = await makeBuild('first', { pages: { index: 'FIRST' } });
		const firstLive = resolvePrerenderDirectory(first, shared);
		await writeFile(join(firstLive, 'only-in-first.html'), 'OLD');
		const second = await makeBuild('second', {
			manifest: '{"Home":"/home.def.js"}',
			pages: { index: 'SECOND' },
			renderedAt: '2000'
		});

		const secondLive = resolvePrerenderDirectory(second, shared);

		expect(secondLive).not.toBe(firstLive);
		expect(await readFile(join(secondLive, 'index.html'), 'utf-8')).toBe(
			'SECOND'
		);
		expect(existsSync(join(secondLive, 'only-in-first.html'))).toBe(false);
	});

	test('two machines running one build share one folder', async () => {
		const pages: Record<string, string> = { index: 'HOME' };
		const here = await makeBuild('machine-a', { pages });
		const there = await makeBuild('machine-b', { pages });

		expect(prerenderBuildId(here)).toBe(prerenderBuildId(there));
		expect(resolvePrerenderDirectory(here, shared)).toBe(
			resolvePrerenderDirectory(there, shared)
		);
	});

	test('a rebuild is a different build, even with the same assets', async () => {
		const before = await makeBuild('before', { pages: { index: 'HOME' } });
		const after = await makeBuild('after', {
			pages: { index: 'HOME' },
			renderedAt: '2000'
		});

		expect(prerenderBuildId(before)).not.toBe(prerenderBuildId(after));
	});

	/* During a rolling deploy the previous build is still serving from
	 * its folder, so the newest few are kept and only older ones go. */
	test('keeps the current build and the two before it, and removes older ones', async () => {
		const folders: string[] = [];
		for (const [index, name] of ['b1', 'b2', 'b3', 'b4'].entries()) {
			// eslint-disable-next-line no-await-in-loop -- built in order, each older than the next
			const buildDir = await makeBuild(name, {
				pages: { index: name },
				renderedAt: String(1000 + index)
			});
			const live = resolvePrerenderDirectory(buildDir, shared);
			// Age each folder explicitly: created within one
			// millisecond, their own times would not order them.
			const age = new Date(Date.now() - (10 - index) * 60_000);
			utimesSync(live, age, age);
			folders.push(live);
		}
		const newest = await makeBuild('b5', {
			pages: { index: 'b5' },
			renderedAt: '5000'
		});

		const live = resolvePrerenderDirectory(newest, shared);

		expect(existsSync(live)).toBe(true);
		expect(folders.map((folder) => existsSync(folder))).toEqual([
			false,
			false,
			true,
			true
		]);
	});

	/* The re-renderer stages new pages in a dot-folder beside the
	 * builds. It is not a build and must never be pruned as one. */
	test('leaves the staging folder alone when pruning', async () => {
		await mkdir(join(shared, '.prerender-staging', 'in-flight'), {
			recursive: true
		});
		const stale = new Date(Date.now() - 86_400_000);
		utimesSync(join(shared, '.prerender-staging'), stale, stale);
		for (const name of ['p1', 'p2', 'p3', 'p4']) {
			// eslint-disable-next-line no-await-in-loop -- one build after another
			const buildDir = await makeBuild(name, {
				pages: { index: name },
				renderedAt: name
			});
			resolvePrerenderDirectory(buildDir, shared);
		}

		expect(readdirSync(shared)).toContain('.prerender-staging');
	});
});

describe('a static.directory that cannot be used', () => {
	/* The server has to start either way: the build's own pages are
	 * still there to serve. A regular file where the directory should
	 * be fails for any user, root included. */
	test('falls back to the build’s pages and says why', async () => {
		const buildDir = await makeBuild('fallback', {
			pages: { index: 'HOME' }
		});
		const blocked = join(root, 'a-file-not-a-directory');
		await writeFile(blocked, '');
		const warnings: string[] = [];

		const directory = usablePrerenderDirectory(
			buildDir,
			join(blocked, 'pages'),
			(message) => warnings.push(message)
		);

		expect(directory).toBe(join(buildDir, '_prerendered'));
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain('cannot be used');
		expect(warnings[0]).toContain('from the build instead');
	});

	test('says nothing when the directory is fine', async () => {
		const buildDir = await makeBuild('fine', { pages: { index: 'HOME' } });
		const warnings: string[] = [];

		usablePrerenderDirectory(buildDir, shared, (message) =>
			warnings.push(message)
		);

		expect(warnings).toEqual([]);
	});
});

describe('whether pages can be updated', () => {
	test('yes in a directory that can be written, leaving nothing behind', async () => {
		const directory = join(root, 'writable');

		expect(prerenderDirectoryProblem(directory)).toBeUndefined();
		expect(readdirSync(directory)).toEqual([]);
	});

	/* A read-only image or a locked-down container. Until this was
	 * checked, every re-render there failed without a word. */
	// Root writes through any mode, so there is nothing to observe.
	const isRoot = process.getuid?.() === 0;

	test.skipIf(isRoot)('no, with the reason, in one that cannot', async () => {
		const directory = join(root, 'read-only');
		await mkdir(directory, { recursive: true });
		chmodSync(directory, 0o555);
		try {
			const problem = prerenderDirectoryProblem(directory);

			expect(problem).toBeDefined();
			expect(problem).toMatch(/EACCES|EPERM|EROFS|permission/i);
		} finally {
			chmodSync(directory, 0o755);
		}
	});
});
