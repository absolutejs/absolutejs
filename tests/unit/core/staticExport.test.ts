import {
	mkdtemp,
	mkdir,
	readFile,
	readdir,
	rm,
	writeFile
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, test } from 'bun:test';
import {
	NOJEKYLL_FILE,
	planStaticExport,
	routeToStaticPath,
	writeStaticExport
} from '../../../src/core/staticExport';
import {
	isServerOnlyBuildFile,
	productionStaticIgnorePatterns
} from '../../../src/core/serverOnlyStaticFiles';

/* What `absolute export` must get right, and why each case is here rather
 * than assumed.
 *
 * The build directory is not an export: measured against the example app's
 * own production build, 21.50 MB of its 27.36 MB is server-only — the
 * bundled server, its 8.09 MB source map, the SSR bundles, the runtime
 * manifests and a 2.77 MB platform-specific native binary. A running
 * server withholds all of it (probed: `/server.js` and `/server.js.map`
 * answer 404), but that protection belongs to the server. A static host
 * has none, so the classification has to happen while the export is being
 * assembled. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const roots: string[] = [];

const tempRoot = async () => {
	const root = await mkdtemp(join(repoRoot, '.static-export-'));
	roots.push(root);

	return root;
};

const neverServerOnly = () => false;

const planOf = (
	buildFiles: readonly string[],
	overrides: {
		isServerOnly?: (path: string) => boolean;
		layout?: 'directory' | 'flat';
		precompressed?: boolean;
		prerendered?: { file: string; route: string }[];
	} = {}
) =>
	planStaticExport({
		buildFiles,
		isServerOnly: overrides.isServerOnly ?? neverServerOnly,
		layout: overrides.layout ?? 'directory',
		precompressed: overrides.precompressed ?? false,
		prerendered: overrides.prerendered ?? []
	});

afterAll(async () => {
	await Promise.all(
		roots.map((root) => rm(root, { force: true, recursive: true }))
	);
});

describe('routeToStaticPath', () => {
	test('the root route is index.html', () => {
		expect(routeToStaticPath('/', 'directory')).toBe('index.html');
		expect(routeToStaticPath('/', 'flat')).toBe('index.html');
	});

	/* The default, because it is the only layout a plain S3 website bucket
	 * serves at `/about` without rules. */
	test('directory layout writes a route as its own index', () => {
		expect(routeToStaticPath('/about', 'directory')).toBe(
			'about/index.html'
		);
		expect(routeToStaticPath('/docs/guide', 'directory')).toBe(
			'docs/guide/index.html'
		);
	});

	test('flat layout writes a sibling .html file', () => {
		expect(routeToStaticPath('/about', 'flat')).toBe('about.html');
		expect(routeToStaticPath('/docs/guide', 'flat')).toBe(
			'docs/guide.html'
		);
	});

	/* `/about/` and `/about` are the same page, and a trailing slash would
	 * otherwise produce `about//index.html`. */
	test('a trailing slash does not change the file', () => {
		expect(routeToStaticPath('/about/', 'directory')).toBe(
			'about/index.html'
		);
		expect(routeToStaticPath('/about/', 'flat')).toBe('about.html');
	});

	/* A query or fragment is not part of a file name and no host sends one
	 * to the filesystem. Keeping them would write `about?tab=1/index.html`. */
	test('a query or fragment is dropped', () => {
		expect(routeToStaticPath('/about?tab=1', 'directory')).toBe(
			'about/index.html'
		);
		expect(routeToStaticPath('/about#top', 'flat')).toBe('about.html');
	});

	test('a route that already names an html file keeps it', () => {
		expect(routeToStaticPath('/legacy.html', 'directory')).toBe(
			'legacy.html'
		);
	});
});

describe('planStaticExport', () => {
	test('a public asset is copied at its own path', () => {
		const plan = planOf(['/chunk-abc.js', '/assets/css/site.css']);

		expect(plan.copies).toEqual([
			{ from: '/chunk-abc.js', to: 'chunk-abc.js' },
			{ from: '/assets/css/site.css', to: 'assets/css/site.css' }
		]);
		expect(plan.skipped).toEqual([]);
	});

	/* The whole reason the command exists. A static host applies no ignore
	 * patterns, so anything the plan copies is downloadable. */
	test('server-only files are withheld with the reason', () => {
		const buildDir = '/project/build';
		const plan = planOf(
			[
				'/server.js',
				'/server.js.map',
				'/manifest.json',
				'/tailwindcss-oxide.darwin-arm64-m4azj13v.node',
				'/.absolute-trace/build-trace-2026-11-22.json',
				'/angular/vendor/server/chunk-szbehpqx.js',
				'/chunk-abc.js'
			],
			{
				isServerOnly: isServerOnlyBuildFile(
					productionStaticIgnorePatterns(
						buildDir,
						join(buildDir, 'server.js')
					)
				)
			}
		);

		expect(plan.copies).toEqual([
			{ from: '/chunk-abc.js', to: 'chunk-abc.js' }
		]);
		expect(plan.skipped.map((skip) => skip.path)).toEqual([
			'/server.js',
			'/server.js.map',
			'/manifest.json',
			'/tailwindcss-oxide.darwin-arm64-m4azj13v.node',
			'/.absolute-trace/build-trace-2026-11-22.json',
			'/angular/vendor/server/chunk-szbehpqx.js'
		]);
		expect(
			plan.skipped.every((skip) => skip.reason === 'server-only')
		).toBe(true);
	});

	/* A React page loads its hydration index from `/.absolutejs/generated/`,
	 * so a dot-directory is public and must survive the walk and the plan.
	 * Dropping it is a page that arrives and never hydrates. */
	test('the generated hydration index is public', () => {
		const path = '/.absolutejs/generated/react/indexes/Page.abc123.js';
		const plan = planOf([path], {
			isServerOnly: isServerOnlyBuildFile(
				productionStaticIgnorePatterns('/build', '/build/server.js')
			)
		});

		expect(plan.copies).toEqual([{ from: path, to: path.slice(1) }]);
	});

	test('pre-rendered HTML is placed at its route, not copied', () => {
		const plan = planOf(['/_prerendered/about.html', '/chunk-abc.js'], {
			prerendered: [
				{ file: '/build/_prerendered/about.html', route: '/about' }
			]
		});

		expect(plan.pages).toEqual([
			{
				file: '/build/_prerendered/about.html',
				route: '/about',
				to: 'about/index.html'
			}
		]);
		expect(plan.skipped).toEqual([
			{ path: '/_prerendered/about.html', reason: 'prerender-source' }
		]);
	});

	/* 1.61 MB of the example app's 5.86 MB public payload. A static host
	 * either negotiates encodings itself or needs per-object metadata a
	 * file tree cannot carry, so by default these are weight nothing will
	 * request. */
	test('pre-compressed siblings are dropped unless asked for', () => {
		const files = ['/chunk-abc.js', '/chunk-abc.js.br', '/chunk-abc.js.gz'];

		expect(planOf(files).copies).toEqual([
			{ from: '/chunk-abc.js', to: 'chunk-abc.js' }
		]);
		expect(
			planOf(files, { precompressed: true }).copies.map((copy) => copy.to)
		).toEqual(['chunk-abc.js', 'chunk-abc.js.br', 'chunk-abc.js.gz']);
	});

	/* A public file and a route can want the same path — `public/about.html`
	 * with a `/about` route under flat layout. The page wins, because it is
	 * the rendered one, but silently is how you lose a file you put there
	 * on purpose. */
	test('a collision between a build file and a route is reported', () => {
		const plan = planOf(['/about.html'], {
			layout: 'flat',
			prerendered: [
				{ file: '/build/_prerendered/about.html', route: '/about' }
			]
		});

		expect(plan.copies).toEqual([]);
		expect(plan.skipped).toEqual([
			{ path: '/about.html', reason: 'page-override' }
		]);
		expect(plan.pages[0]?.to).toBe('about.html');
	});
});

describe('writeStaticExport', () => {
	test('writes the plan, nested paths included, and .nojekyll', async () => {
		const root = await tempRoot();
		const buildDir = join(root, 'build');
		const exportDir = join(root, 'out');
		await mkdir(join(buildDir, 'assets', 'css'), { recursive: true });
		await mkdir(join(buildDir, '_prerendered'), { recursive: true });
		await mkdir(exportDir, { recursive: true });
		await writeFile(join(buildDir, 'assets', 'css', 'site.css'), 'a{}');
		await writeFile(
			join(buildDir, '_prerendered', 'about.html'),
			'<!doctype html><title>About</title>'
		);

		const plan = planOf(
			['/assets/css/site.css', '/_prerendered/about.html'],
			{
				prerendered: [
					{
						file: join(buildDir, '_prerendered', 'about.html'),
						route: '/about'
					}
				]
			}
		);
		const written = await writeStaticExport(plan, buildDir, exportDir);

		expect(
			await readFile(
				join(exportDir, 'assets', 'css', 'site.css'),
				'utf-8'
			)
		).toBe('a{}');
		expect(
			await readFile(join(exportDir, 'about', 'index.html'), 'utf-8')
		).toContain('About');
		expect(await readdir(exportDir)).toContain(NOJEKYLL_FILE);
		/* One asset, one page, one `.nojekyll`. */
		expect(written.files).toBe(3);
		expect(written.bytes).toBeGreaterThan(0);
	});

	/* GitHub Pages runs Jekyll, which skips every path beginning with `.`
	 * or `_`. The hydration index lives under `/.absolutejs/`, so without
	 * this file a React page is served and never hydrates — a failure that
	 * looks like a framework bug rather than a host default. */
	test('.nojekyll is written even for an export with no pages', async () => {
		const root = await tempRoot();
		const buildDir = join(root, 'build');
		const exportDir = join(root, 'out');
		await mkdir(buildDir, { recursive: true });
		await mkdir(exportDir, { recursive: true });

		const written = await writeStaticExport(
			planOf([]),
			buildDir,
			exportDir
		);

		expect(await readdir(exportDir)).toEqual([NOJEKYLL_FILE]);
		expect(written.files).toBe(1);
	});
});
