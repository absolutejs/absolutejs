import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { unservedPath } from '../../helpers/unservedPath';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import type { Page } from 'playwright';
import { build } from '../../../src/core/build';
import { handleReactPageRequest } from '../../../src/react/pageHandler';
import { openPage, type BrowserSession } from '../../helpers/browser';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

/* Static HTML pages take part in soft navigation (navigation plan phase 2).
 *
 * The layer refuses to swap a page that registered no
 * `__ABSOLUTE_PAGE_DISPOSE__`, which is right for a framework page whose
 * hydration index never finished and wrong for a static page, where there
 * is nothing to tear down. So a static page could be navigated TO and
 * never FROM: React → HTML soft-navigated, and the link back did a full
 * document load.
 *
 * Both routes to a teardown hook are covered here:
 *
 *  - swapped in: the document has no module script and no inline
 *    `import()`, so no index is coming and the layer marks it itself;
 *  - entered cold: the page calls `enableNavigation()` like any other
 *    participating page, and that call marks it.
 *
 * `seen.documentLoads` is the assertion that matters — a reload would
 * both pass a "did we get there" check and lose the whole point. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const fixtureRoot = join(
	repoRoot,
	'.test-builds',
	`static-page-navigation-${process.pid}`
);

const REACT_PAGE = `import { useEffect } from 'react';
import { enableNavigation } from '@absolutejs/absolute/client/navigation';

export function NavHost() {
	useEffect(() => {
		enableNavigation();
	}, []);

	return (
		<html lang="en">
			<head>
				<title>React host</title>
			</head>
			<body>
				<div id="react-page" data-hydrated="true">
					<a href="/plain" id="to-plain">plain</a>
					<a href="/cold" id="to-cold">cold</a>
				</div>
			</body>
		</html>
	);
}
`;

/* No script of any kind: this is the page the layer has to recognise as
 * having nothing to tear down. */
const PLAIN_PAGE = `<!doctype html>
<html lang="en">
	<head><title>Plain page</title></head>
	<body>
		<div id="plain-page">
			<a href="/react" id="to-react">react</a>
		</div>
	</body>
</html>
`;

/* A static page entered directly, which installs the layer itself. It
 * imports the published client module the way an app would, served here
 * from dist/ so the page needs no build step of its own. */
const COLD_PAGE = `<!doctype html>
<html lang="en">
	<head><title>Cold page</title></head>
	<body>
		<div id="cold-page">
			<a href="/react" id="to-react">react</a>
		</div>
		<script type="module">
			import { enableNavigation } from '/dist/client/navigation.js';
			enableNavigation();
			document.getElementById('cold-page').dataset.ready = 'true';
		</script>
	</body>
</html>
`;

type ServedApp = { baseUrl: string; stop: () => void };

let app: ServedApp | undefined;

const isReactPage = (
	value: unknown
): value is Parameters<typeof handleReactPageRequest>[0]['Page'] =>
	typeof value === 'function';

const contentType = (path: string) => {
	if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
	if (path.endsWith('.css')) return 'text/css; charset=utf-8';
	if (path.endsWith('.map')) return 'application/json; charset=utf-8';

	return 'application/octet-stream';
};

const createApp = (
	buildDir: string,
	manifest: Record<string, string>,
	Page: Parameters<typeof handleReactPageRequest>[0]['Page']
) => {
	const html = (body: string) =>
		new Response(body, {
			headers: { 'Content-Type': 'text/html; charset=utf-8' }
		});

	return async (request: Request) => {
		const { pathname } = new URL(request.url);
		if (pathname === '/react') {
			return handleReactPageRequest({
				index: manifest.NavHostIndex ?? '',
				Page,
				props: {},
				request
			});
		}
		if (pathname === '/plain') return html(PLAIN_PAGE);
		if (pathname === '/cold') return html(COLD_PAGE);
		// The published client runtime, as an installed app would import it.
		if (pathname.startsWith('/dist/')) {
			const distFile = join(repoRoot, pathname.slice(1));
			if (!existsSync(distFile))
				return new Response(null, { status: 404 });

			return new Response(Bun.file(distFile), {
				headers: { 'Content-Type': contentType(distFile) }
			});
		}
		if (extname(pathname) === '') return unservedPath(pathname);
		const filePath = join(buildDir, pathname);
		if (!existsSync(filePath)) return new Response(null, { status: 404 });

		return new Response(Bun.file(filePath), {
			headers: { 'Content-Type': contentType(filePath) }
		});
	};
};

beforeAll(async () => {
	await ensureDistBuild();
	await mkdir(join(fixtureRoot, 'react', 'pages'), { recursive: true });
	await writeFile(
		join(fixtureRoot, 'react', 'pages', 'NavHost.tsx'),
		REACT_PAGE
	);
	const rel = (path: string) =>
		relative(process.cwd(), join(fixtureRoot, path));
	const result = await build({
		buildDirectory: rel('build'),
		mode: 'production',
		options: { throwOnError: true },
		reactDirectory: rel('react')
	});
	const manifest = result?.manifest ?? {};
	const pageModule: unknown = await import(
		join(fixtureRoot, 'react', 'pages', 'NavHost.tsx')
	);
	const Page: unknown =
		typeof pageModule === 'object' && pageModule !== null
			? Reflect.get(pageModule, 'NavHost')
			: undefined;
	if (!isReactPage(Page)) throw new Error('NavHost page did not load');
	const server = Bun.serve({
		fetch: createApp(join(fixtureRoot, 'build'), manifest, Page),
		port: 0
	});
	app = {
		baseUrl: `http://localhost:${server.port}`,
		stop: () => server.stop(true)
	};
}, 240_000);

afterAll(async () => {
	app?.stop();
	await rm(fixtureRoot, { force: true, recursive: true });
});

const baseUrl = () => {
	if (!app) throw new Error('fixture app is not running');

	return app.baseUrl;
};

type Observations = { documentLoads: string[]; errors: string[] };

const withPage = async (
	path: string,
	run: (page: Page, seen: Observations) => Promise<void>
) => {
	const seen: Observations = { documentLoads: [], errors: [] };
	const session: BrowserSession = await openPage(`${baseUrl()}${path}`, {
		waitUntil: 'load'
	});
	try {
		const { page } = session;
		page.on('pageerror', (error) => seen.errors.push(error.message));
		page.on('request', (request) => {
			if (request.resourceType() === 'document')
				seen.documentLoads.push(request.url());
		});
		// Survives a soft navigation, gone after a real document load.
		await page.evaluate(() => Reflect.set(window, '__sameDocument', true));
		await run(page, seen);
	} finally {
		await session.close();
	}
};

const sameDocument = (page: Page) =>
	page.evaluate(() => Reflect.get(window, '__sameDocument') === true);

const pathnameOf = (page: Page) => new URL(page.url()).pathname;

const canTearDown = (page: Page) =>
	page.evaluate(
		() =>
			typeof Reflect.get(window, '__ABSOLUTE_PAGE_DISPOSE__') ===
			'function'
	);

describe('a static page swapped in by another page', () => {
	test('can be navigated away from without a document load', async () => {
		await withPage('/react', async (page, seen) => {
			await page.waitForSelector('#react-page[data-hydrated="true"]', {
				timeout: 15_000
			});
			await page.click('#to-plain');
			await page.waitForSelector('#plain-page', { timeout: 15_000 });

			expect(pathnameOf(page)).toBe('/plain');
			expect(await sameDocument(page)).toBe(true);
			// The layer recognised a page with no index coming and marked it
			// itself; without that the link below does a full load.
			expect(await canTearDown(page)).toBe(true);

			await page.click('#to-react');
			await page.waitForSelector('#react-page[data-hydrated="true"]', {
				timeout: 15_000
			});

			expect(pathnameOf(page)).toBe('/react');
			expect(await sameDocument(page)).toBe(true);
			expect(seen.documentLoads).toEqual([]);
			expect(seen.errors).toEqual([]);
		});
	}, 120_000);
});

describe('a static page entered directly', () => {
	test('installs the layer and navigates away in place', async () => {
		await withPage('/cold', async (page, seen) => {
			await page.waitForSelector('#cold-page[data-ready="true"]', {
				timeout: 15_000
			});

			// `enableNavigation()` marked it: there is no framework app here,
			// so the call that installs the layer is also what says so.
			expect(await canTearDown(page)).toBe(true);

			await page.click('#to-react');
			await page.waitForSelector('#react-page[data-hydrated="true"]', {
				timeout: 15_000
			});

			expect(pathnameOf(page)).toBe('/react');
			expect(await sameDocument(page)).toBe(true);
			expect(seen.documentLoads).toEqual([]);
			expect(seen.errors).toEqual([]);
		});
	}, 120_000);
});
