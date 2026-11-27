import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import type { Page } from 'playwright';
import { build } from '../../../src/core/build';
import { handleReactPageRequest } from '../../../src/react/pageHandler';
import { openPage, type BrowserSession } from '../../helpers/browser';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';
import { unservedPath } from '../../helpers/unservedPath';

/* A navigation that changes only the query string — the next page of a
 * list, a filter — on a page that is already mounted.
 *
 * The page is handed the new data and stays mounted: no document is
 * fetched and nothing is torn down. Everything asserted is either
 * something a visitor would notice (the rows, the address, the back
 * button, the caret in the search box) or the thing that makes it
 * cheaper (how many documents the server was asked for).
 *
 * As much of this file is about when it must NOT happen: another path,
 * an app that turned it off, a query the route answers with a different
 * page. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const fixtureRoot = join(
	repoRoot,
	'.test-builds',
	`in-place-navigation-${process.pid}`
);
const fromSource = (path: string) =>
	resolve(repoRoot, 'src', path).replace(/\\/g, '/');

const LIST_PAGE = `import { useEffect, useState } from 'react';
import { enableNavigation, navigateDocument } from '${fromSource('client/navigation')}';

type Props = { inPlace: boolean; page: number; query: string; rows: string[] };

export function ListPage({ inPlace, page, query, rows }: Props) {
	const [clicks, setClicks] = useState(0);
	useEffect(() => {
		enableNavigation(inPlace ? {} : { inPlace: false });
		Reflect.set(window, '__go', navigateDocument);
		Reflect.set(window, '__pageHydrated', true);
		// How many times a page has been mounted in this document.
		Reflect.set(window, '__mounts', Number(Reflect.get(window, '__mounts') ?? 0) + 1);
	}, [inPlace]);

	return (
		<html lang="en">
			<head>
				<title>{\`Page \${page}\`}</title>
			</head>
			<body>
				<div id="list-page">
					<h1 id="heading">Page {page}</h1>
					<form action="" id="filter" method="get">
						<input defaultValue={query} id="q" name="q" type="text" />
					</form>
					<button id="clicks" type="button" onClick={() => setClicks(clicks + 1)}>
						{clicks}
					</button>
					<ul id="rows">
						{rows.map((row) => (
							<li key={row}>{row}</li>
						))}
					</ul>
					<div style={{ height: '3000px' }} />
					<a href={\`?page=\${page + 1}\`} id="next">next</a>
					<a href="?page=other" id="to-other-by-query">another page, same path</a>
					<a href="?page=moved" id="to-moved">moved</a>
					<a href="/elsewhere?page=1" id="to-elsewhere">another path</a>
				</div>
			</body>
		</html>
	);
}
`;

const OTHER_PAGE = `import { useEffect } from 'react';
import { enableNavigation } from '${fromSource('client/navigation')}';

export function OtherPage() {
	useEffect(() => {
		enableNavigation();
		Reflect.set(window, '__otherHydrated', true);
	}, []);

	return (
		<html lang="en">
			<head>
				<title>Other</title>
			</head>
			<body>
				<div id="other-page">other</div>
			</body>
		</html>
	);
}
`;

type Asked = { documents: number };

type ServedApp = { asked: Asked; baseUrl: string; stop: () => void };

let app: ServedApp | undefined;

type ReactPage = Parameters<typeof handleReactPageRequest>[0]['Page'];

const isReactPage = (value: unknown): value is ReactPage =>
	typeof value === 'function';

const contentType = (path: string) => {
	if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
	if (path.endsWith('.css')) return 'text/css; charset=utf-8';

	return 'application/octet-stream';
};

const LIST_PATHS = new Set(['/list', '/list-off', '/elsewhere']);

const rowsFor = (page: number, query: string) =>
	['a', 'b', 'c']
		.map((letter) => `row ${page}${letter}`)
		.filter((row) => row.includes(query));

type Pages = { List: unknown; Other: unknown };

const createApp =
	(
		buildDir: string,
		manifest: Record<string, string>,
		pages: Pages,
		asked: Asked
	) =>
	async (request: Request) => {
		const url = new URL(request.url);
		const { pathname } = url;
		const pageParam = url.searchParams.get('page') ?? '1';
		if (LIST_PATHS.has(pathname) && pageParam === 'moved') {
			url.searchParams.set('page', '7');

			return Response.redirect(url, 302);
		}
		const wantsDocument = !(request.headers.get('accept') ?? '').includes(
			'vnd.absolute.route'
		);
		if (LIST_PATHS.has(pathname) && wantsDocument) asked.documents += 1;
		// The same path answering with a different page: what the data's
		// own account of which page it is for exists to catch.
		if (
			LIST_PATHS.has(pathname) &&
			pageParam === 'other' &&
			isReactPage(pages.Other)
		)
			return handleReactPageRequest({
				index: manifest.OtherPageIndex ?? '',
				Page: pages.Other,
				props: {},
				request
			});
		if (LIST_PATHS.has(pathname) && isReactPage(pages.List)) {
			const page = Number(pageParam);
			const query = url.searchParams.get('q') ?? '';

			return handleReactPageRequest({
				index: manifest.ListPageIndex ?? '',
				Page: pages.List,
				props: {
					inPlace: pathname !== '/list-off',
					page,
					query,
					rows: rowsFor(page, query)
				},
				request
			});
		}
		if (extname(pathname) === '') return unservedPath(pathname);
		const filePath = join(buildDir, pathname);
		if (!existsSync(filePath)) return new Response(null, { status: 404 });

		return new Response(Bun.file(filePath), {
			headers: { 'Content-Type': contentType(filePath) }
		});
	};

const exported = async (file: string, name: string) => {
	const loaded: unknown = await import(
		join(fixtureRoot, 'react', 'pages', file)
	);

	return typeof loaded === 'object' && loaded !== null
		? (Reflect.get(loaded, name) as unknown)
		: undefined;
};

beforeAll(async () => {
	await ensureDistBuild();
	await mkdir(join(fixtureRoot, 'react', 'pages'), { recursive: true });
	await writeFile(
		join(fixtureRoot, 'react', 'pages', 'ListPage.tsx'),
		LIST_PAGE
	);
	await writeFile(
		join(fixtureRoot, 'react', 'pages', 'OtherPage.tsx'),
		OTHER_PAGE
	);
	const rel = (path: string) =>
		relative(process.cwd(), join(fixtureRoot, path));
	const result = await build({
		buildDirectory: rel('build'),
		mode: 'production',
		options: { throwOnError: true },
		reactDirectory: rel('react')
	});
	const asked: Asked = { documents: 0 };
	const server = Bun.serve({
		fetch: createApp(
			join(fixtureRoot, 'build'),
			result?.manifest ?? {},
			{
				List: await exported('ListPage.tsx', 'ListPage'),
				Other: await exported('OtherPage.tsx', 'OtherPage')
			},
			asked
		),
		port: 0
	});
	app = {
		asked,
		baseUrl: `http://localhost:${server.port}`,
		stop: () => server.stop(true)
	};
}, 300_000);

afterAll(async () => {
	app?.stop();
	await rm(fixtureRoot, { force: true, recursive: true });
});

const served = () => {
	if (!app) throw new Error('fixture app is not running');

	return app;
};

const rowTexts = (page: Page) => page.locator('#rows li').allTextContents();

const read = (page: Page, name: string) =>
	page.evaluate((key) => Reflect.get(window, key), name);

const addressOf = (page: Page) => {
	const url = new URL(page.url());

	return `${url.pathname}${url.search}`;
};

/* Opens a list page and marks the window: a mark still there afterwards
 * means the document was never loaded again. The count of documents the
 * server was asked for starts from here. */
const openList = async (path: string) => {
	const { asked, baseUrl } = served();
	const session: BrowserSession = await openPage(`${baseUrl}${path}`, {
		waitUntil: 'load'
	});
	await session.page.waitForFunction(
		() => Reflect.get(window, '__pageHydrated') === true,
		undefined,
		{ timeout: 30_000 }
	);
	await session.page.evaluate(() => {
		Reflect.set(window, '__sameDocument', true);
	});
	asked.documents = 0;

	return session;
};

const waitForHeading = (page: Page, text: string) =>
	page.waitForFunction(
		(expected) =>
			document.getElementById('heading')?.textContent === expected,
		text,
		{ timeout: 30_000 }
	);

/* A link at the bottom of a tall page: dispatched, not clicked, because
 * a click scrolls its target into view first and the scroll position is
 * one of the things under test. */
const follow = (page: Page, selector: string) =>
	page.locator(selector).dispatchEvent('click');

describe('a navigation that changes only the query', () => {
	test('gives the mounted page the new data: no document, no remount', async () => {
		const session = await openList('/list?page=1');
		try {
			const { page } = session;
			await page.click('#clicks');
			await page.evaluate(() => window.scrollTo(0, 1200));

			await follow(page, '#next');
			await waitForHeading(page, 'Page 2');

			expect(await rowTexts(page)).toEqual([
				'row 2a',
				'row 2b',
				'row 2c'
			]);
			expect(addressOf(page)).toBe('/list?page=2');
			expect(await page.title()).toBe('Page 2');
			// It is a navigation: the window starts at the top.
			expect(await page.evaluate(() => window.scrollY)).toBe(0);
			// And it is the same page: mounted once, still holding its
			// state, in the document that was opened.
			expect(await read(page, '__mounts')).toBe(1);
			expect(await page.locator('#clicks').textContent()).toBe('1');
			expect(await read(page, '__sameDocument')).toBe(true);
			expect(served().asked.documents).toBe(0);
		} finally {
			await session.close();
		}
	}, 120_000);

	test('reports `updated` to whoever asked for it', async () => {
		const session = await openList('/list?page=1');
		try {
			const { page } = session;

			const outcome = await page.evaluate(() => {
				const navigate: unknown = Reflect.get(window, '__go');

				return typeof navigate === 'function'
					? (Reflect.apply(navigate, undefined, [
							'/list?page=4'
						]) as unknown)
					: undefined;
			});
			await waitForHeading(page, 'Page 4');

			expect(outcome).toBe('updated');
			expect(served().asked.documents).toBe(0);
		} finally {
			await session.close();
		}
	}, 120_000);

	test('back and forward move through the pages the same way', async () => {
		const session = await openList('/list?page=1');
		try {
			const { page } = session;
			await follow(page, '#next');
			await waitForHeading(page, 'Page 2');
			await page.evaluate(() => window.scrollTo(0, 900));
			// Long enough for the position to be filed under this entry.
			await page.waitForTimeout(200);
			await follow(page, '#next');
			await waitForHeading(page, 'Page 3');

			await page.goBack();
			await waitForHeading(page, 'Page 2');
			expect(addressOf(page)).toBe('/list?page=2');
			expect(await rowTexts(page)).toEqual([
				'row 2a',
				'row 2b',
				'row 2c'
			]);
			expect(await page.evaluate(() => window.scrollY)).toBe(900);

			await page.goBack();
			await waitForHeading(page, 'Page 1');
			expect(addressOf(page)).toBe('/list?page=1');

			await page.goForward();
			await waitForHeading(page, 'Page 2');

			expect(await read(page, '__mounts')).toBe(1);
			expect(await read(page, '__sameDocument')).toBe(true);
			expect(served().asked.documents).toBe(0);
		} finally {
			await session.close();
		}
	}, 120_000);

	/* A search form submitted from its own field. The results arrive
	 * and the caret is still where the visitor left it. */
	test('a submitted filter keeps the field being typed in', async () => {
		const session = await openList('/list?page=1');
		try {
			const { page } = session;
			await page.fill('#q', '1b');

			await page.press('#q', 'Enter');
			await page.waitForFunction(
				() => document.querySelectorAll('#rows li').length === 1,
				undefined,
				{ timeout: 30_000 }
			);

			expect(await rowTexts(page)).toEqual(['row 1b']);
			expect(addressOf(page)).toBe('/list?q=1b');
			expect(await page.inputValue('#q')).toBe('1b');
			expect(await page.evaluate(() => document.activeElement?.id)).toBe(
				'q'
			);
			expect(await read(page, '__mounts')).toBe(1);
			expect(served().asked.documents).toBe(0);
		} finally {
			await session.close();
		}
	}, 120_000);

	test('follows a redirect to the address it ends at', async () => {
		const session = await openList('/list?page=1');
		try {
			const { page } = session;

			await follow(page, '#to-moved');
			await waitForHeading(page, 'Page 7');

			expect(addressOf(page)).toBe('/list?page=7');
			expect(await read(page, '__mounts')).toBe(1);
			expect(served().asked.documents).toBe(0);
		} finally {
			await session.close();
		}
	}, 120_000);
});

describe('the page is replaced, as before', () => {
	test('when the path changes, even to the same page', async () => {
		const session = await openList('/list?page=1');
		try {
			const { page } = session;
			await page.click('#clicks');

			await follow(page, '#to-elsewhere');
			await page.waitForFunction(
				() => Reflect.get(window, '__mounts') === 2,
				undefined,
				{ timeout: 30_000 }
			);

			expect(addressOf(page)).toBe('/elsewhere?page=1');
			// A new page: its state starts over.
			expect(await page.locator('#clicks').textContent()).toBe('0');
			expect(await read(page, '__sameDocument')).toBe(true);
			expect(served().asked.documents).toBe(1);
		} finally {
			await session.close();
		}
	}, 120_000);

	test('when the app turned it off', async () => {
		const session = await openList('/list-off?page=1');
		try {
			const { page } = session;
			await page.click('#clicks');

			await follow(page, '#next');
			await page.waitForFunction(
				() =>
					Reflect.get(window, '__mounts') === 2 &&
					document.getElementById('heading')?.textContent ===
						'Page 2',
				undefined,
				{ timeout: 30_000 }
			);

			expect(addressOf(page)).toBe('/list-off?page=2');
			expect(await page.locator('#clicks').textContent()).toBe('0');
			expect(served().asked.documents).toBe(1);
		} finally {
			await session.close();
		}
	}, 120_000);

	/* The data says which page it is for. This query is answered with
	 * another page's, so nothing is handed to the one on screen. */
	test('when the same path answers with a different page', async () => {
		const session = await openList('/list?page=1');
		try {
			const { page } = session;

			await follow(page, '#to-other-by-query');
			await page.waitForFunction(
				() => Reflect.get(window, '__otherHydrated') === true,
				undefined,
				{ timeout: 30_000 }
			);

			expect(await page.locator('#other-page').textContent()).toBe(
				'other'
			);
			expect(await page.locator('#list-page').count()).toBe(0);
			expect(addressOf(page)).toBe('/list?page=other');
			expect(await read(page, '__sameDocument')).toBe(true);
		} finally {
			await session.close();
		}
	}, 120_000);
});
