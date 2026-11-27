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

/* `invalidate()`: after the browser changes data a page shows, the page
 * is fetched again and swapped in place.
 *
 * The page here lists what the server holds. A button adds an item with
 * a plain `fetch` — a change the framework had no part in — and then
 * calls `invalidate()`. Everything asserted is about what a visitor
 * would notice: the new item is there, the document was not reloaded,
 * the window did not jump, the back button still goes where it did.
 *
 * The page is served `Cache-Control: max-age`, so a refresh that asked
 * the HTTP cache would be handed the list from before the change. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const fixtureRoot = join(repoRoot, '.test-builds', `invalidate-${process.pid}`);
const fromSource = (path: string) =>
	resolve(repoRoot, 'src', path).replace(/\\/g, '/');

/* The layer and `invalidate` are imported from the sources under test
 * rather than the package name, which would load whatever was built
 * into `dist/` last. */
const REACT_PAGE = `import { useEffect, useState } from 'react';
import { enableNavigation } from '${fromSource('client/navigation')}';
import { invalidate } from '${fromSource('client/invalidate')}';
import { enhanceForms } from '${fromSource('client/formActions')}';

type Props = { items: string[]; layer: boolean };

export function InvalidatePage({ items, layer }: Props) {
	const [clicks, setClicks] = useState(0);
	useEffect(() => {
		if (layer) enableNavigation();
		const removeEnhancement = enhanceForms();
		Reflect.set(window, '__pageHydrated', true);
		// How many times the page has been mounted in this document.
		Reflect.set(window, '__mounts', Number(Reflect.get(window, '__mounts') ?? 0) + 1);

		return removeEnhancement;
	}, [layer]);
	const add = async () => {
		await fetch('/api/add', { method: 'POST' });
		Reflect.set(window, '__outcome', await invalidate());
	};

	return (
		<html lang="en">
			<head>
				<title>Items</title>
			</head>
			<body>
				<div id="page">
					<h1>Items</h1>
					<input id="note" type="text" />
					<button id="add" type="button" onClick={() => void add()}>
						add
					</button>
					<button
						id="clicks"
						type="button"
						onClick={() => setClicks(clicks + 1)}
					>
						{clicks}
					</button>
					<form
						action="/actions/add"
						data-absolute-action=""
						id="add-form"
						method="post"
					>
						<button id="add-by-form" type="submit">
							add by form
						</button>
					</form>
					<ul id="items">
						{items.map((item) => (
							<li key={item}>{item}</li>
						))}
					</ul>
					<div style={{ height: '3000px' }} />
				</div>
			</body>
		</html>
	);
}
`;

type ServedApp = { baseUrl: string; items: string[]; stop: () => void };

let app: ServedApp | undefined;

const isReactPage = (
	value: unknown
): value is Parameters<typeof handleReactPageRequest>[0]['Page'] =>
	typeof value === 'function';

const contentType = (path: string) => {
	if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
	if (path.endsWith('.css')) return 'text/css; charset=utf-8';

	return 'application/octet-stream';
};

/* Cacheable for ten minutes, so only a refresh that bypasses the HTTP
 * cache can see a change made after the first load. */
const PAGE_PATHS = new Set(['/items', '/plain', '/document-only', '/expiring']);

const cacheable = async (response: Response) => {
	const headers = new Headers(response.headers);
	headers.set('Cache-Control', 'private, max-age=600');

	return new Response(await response.text(), {
		headers,
		status: response.status
	});
};

const createApp =
	(
		buildDir: string,
		manifest: Record<string, string>,
		Page: unknown,
		items: string[]
	) =>
	async (request: Request) => {
		const { pathname } = new URL(request.url);
		if (pathname === '/api/add' && request.method === 'POST') {
			items.push(`item ${items.length + 1}`);

			return Response.json({ count: items.length });
		}
		// What a form route answers the browser helpers with.
		if (pathname === '/actions/add' && request.method === 'POST') {
			items.push(`item ${items.length + 1}`);

			return Response.json({ status: 'success' });
		}
		// A session that ended: once the page is open, every request
		// for it is sent somewhere else.
		if (pathname === '/expiring' && items.length > 1)
			return Response.redirect(new URL('/items', request.url), 302);
		if (PAGE_PATHS.has(pathname) && isReactPage(Page))
			return cacheable(
				await handleReactPageRequest({
					index: manifest.InvalidatePageIndex ?? '',
					Page,
					props: { items: [...items], layer: pathname !== '/plain' },
					// A server that does not answer with data: it is
					// asked for the page's data and sends the document.
					request:
						pathname === '/document-only'
							? new Request(request.url, {
									headers: { accept: 'text/html' }
								})
							: request
				})
			);
		if (extname(pathname) === '') return unservedPath(pathname);
		const filePath = join(buildDir, pathname);
		if (!existsSync(filePath)) return new Response(null, { status: 404 });

		return new Response(Bun.file(filePath), {
			headers: { 'Content-Type': contentType(filePath) }
		});
	};

beforeAll(async () => {
	await ensureDistBuild();
	await mkdir(join(fixtureRoot, 'react', 'pages'), { recursive: true });
	await writeFile(
		join(fixtureRoot, 'react', 'pages', 'InvalidatePage.tsx'),
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
	const pageModule: unknown = await import(
		join(fixtureRoot, 'react', 'pages', 'InvalidatePage.tsx')
	);
	const Page: unknown =
		typeof pageModule === 'object' && pageModule !== null
			? Reflect.get(pageModule, 'InvalidatePage')
			: undefined;
	const items: string[] = [];
	const server = Bun.serve({
		fetch: createApp(
			join(fixtureRoot, 'build'),
			result?.manifest ?? {},
			Page,
			items
		),
		port: 0
	});
	app = {
		baseUrl: `http://localhost:${server.port}`,
		items,
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

const itemTexts = (page: Page) => page.locator('#items li').allTextContents();

const waitForHydration = (page: Page) =>
	page.waitForFunction(
		() => Reflect.get(window, '__pageHydrated') === true,
		undefined,
		{ timeout: 30_000 }
	);

/* Opens the page with the server's list reset to one item, and marks
 * the window: a mark that is still there afterwards means the document
 * was never reloaded. */
const openItems = async (path: string) => {
	const { baseUrl, items } = served();
	items.splice(0, items.length, 'item 1');
	const session: BrowserSession = await openPage(`${baseUrl}${path}`, {
		waitUntil: 'load'
	});
	await waitForHydration(session.page);
	await session.page.evaluate(() => {
		Reflect.set(window, '__sameDocument', true);
		Reflect.set(window, '__pageHydrated', false);
	});

	return session;
};

/* Until the list has `count` items. For a refresh that replaced the
 * page (`replaced`), also until the new copy has hydrated: its marker
 * was cleared when the page was opened. A page refreshed in place never
 * hydrates again, which is the point. */
const waitForItems = (page: Page, count: number, replaced = false) =>
	page.waitForFunction(
		({ expected, needsHydration }) =>
			document.querySelectorAll('#items li').length === expected &&
			(!needsHydration || Reflect.get(window, '__pageHydrated') === true),
		{ expected: count, needsHydration: replaced },
		{ timeout: 30_000 }
	);

const outcomeOf = (page: Page) =>
	page
		.waitForFunction(() => Reflect.get(window, '__outcome') !== undefined)
		.then(() => page.evaluate(() => Reflect.get(window, '__outcome')));

const mountsOf = (page: Page) =>
	page.evaluate(() => Reflect.get(window, '__mounts'));

describe('invalidate()', () => {
	test('shows the changed data without reloading the document', async () => {
		const session = await openItems('/items');
		try {
			const { page } = session;
			expect(await itemTexts(page)).toEqual(['item 1']);

			await page.click('#add');
			await waitForItems(page, 2);

			expect(await itemTexts(page)).toEqual(['item 1', 'item 2']);
			expect(
				await page.evaluate(() => Reflect.get(window, '__sameDocument'))
			).toBe(true);
			expect(await outcomeOf(page)).toBe('updated');
		} finally {
			await session.close();
		}
	}, 120_000);

	test('keeps the address, the history entry and the visitor’s place on the page', async () => {
		const session = await openItems('/items?view=all');
		try {
			const { page } = session;
			const before = await page.evaluate(() => {
				window.scrollTo(0, 400);

				return { entries: window.history.length, url: location.href };
			});

			// Not `page.click`: it scrolls its target into view first,
			// and the button is at the top of the page.
			await page.evaluate(() => {
				document
					.getElementById('add')
					?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			});
			await waitForItems(page, 2);

			const after = await page.evaluate(() => ({
				entries: window.history.length,
				scrollY: window.scrollY,
				url: location.href
			}));
			expect(after.url).toBe(before.url);
			expect(after.entries).toBe(before.entries);
			/* Not exactly 400: an item was added above what is in view,
			 * and the browser moves the window by that item's height so
			 * the content being looked at stays put (scroll anchoring).
			 * Nothing here sets the scroll position at all — the page
			 * was never replaced — so what matters is that the visitor
			 * was not thrown back to the top. */
			expect(after.scrollY).toBeGreaterThanOrEqual(400);
			expect(after.scrollY).toBeLessThan(480);
		} finally {
			await session.close();
		}
	}, 120_000);

	/* The page is the same page, so a keyboard user should still be where
	 * they were: not sent to the heading as a navigation would send them. */
	test('puts focus back on the element that had it', async () => {
		const session = await openItems('/items');
		try {
			const { page } = session;
			await page.focus('#note');
			await page.evaluate(() => {
				const add = document.getElementById('add');
				// A click would move focus to the button; this is the
				// same handler without that.
				add?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			});
			await waitForItems(page, 2);

			expect(await page.evaluate(() => document.activeElement?.id)).toBe(
				'note'
			);
		} finally {
			await session.close();
		}
	}, 120_000);

	/* The reason it is done this way. The page is handed new props; it
	 * is never unmounted, so everything its components hold is still
	 * there — where replacing the page used to start it all over. */
	test('keeps what the page’s components are holding', async () => {
		const session = await openItems('/items');
		try {
			const { page } = session;
			await page.click('#clicks');
			await page.click('#clicks');
			await page.fill('#note', 'half-typed');

			await page.click('#add');
			await waitForItems(page, 2);

			expect(await page.locator('#clicks').textContent()).toBe('2');
			expect(await page.inputValue('#note')).toBe('half-typed');
			expect(await mountsOf(page)).toBe(1);
		} finally {
			await session.close();
		}
	}, 120_000);

	test('applies the newest data when refreshed twice in a row', async () => {
		const session = await openItems('/items');
		try {
			const { page } = session;

			await page.click('#add');
			await page.click('#add');
			await waitForItems(page, 3);

			expect(await itemTexts(page)).toEqual([
				'item 1',
				'item 2',
				'item 3'
			]);
			expect(await mountsOf(page)).toBe(1);
		} finally {
			await session.close();
		}
	}, 120_000);

	/* An enhanced form, with nothing on it asking for a refresh: the
	 * action changes the data, and the page shows it without the app
	 * writing a line. */
	test('an enhanced form refreshes the page on success, unasked', async () => {
		const session = await openItems('/items');
		try {
			const { page } = session;

			await page.click('#add-by-form');
			await waitForItems(page, 2);

			expect(await itemTexts(page)).toEqual(['item 1', 'item 2']);
			expect(
				await page.evaluate(() => Reflect.get(window, '__sameDocument'))
			).toBe(true);
		} finally {
			await session.close();
		}
	}, 120_000);

	/* It does not need the navigation layer: it is a request for data
	 * and a re-render, not a page swap. */
	test('works on a page without the navigation layer', async () => {
		const session = await openItems('/plain');
		try {
			const { page } = session;

			await page.click('#add');
			await waitForItems(page, 2);

			expect(await outcomeOf(page)).toBe('updated');
			expect(
				await page.evaluate(() => Reflect.get(window, '__sameDocument'))
			).toBe(true);
		} finally {
			await session.close();
		}
	}, 120_000);
});

describe('invalidate() when the page cannot simply be given new data', () => {
	/* The server answers the data request with the document. The page
	 * is refreshed the way it always was: fetched whole and swapped. */
	test('refreshes the whole page when the server does not answer with data', async () => {
		const session = await openItems('/document-only');
		try {
			const { page } = session;

			await page.click('#add');
			await waitForItems(page, 2, true);

			expect(await itemTexts(page)).toEqual(['item 1', 'item 2']);
			expect(await outcomeOf(page)).toBe('swapped');
			// Replaced, not updated: mounted a second time.
			expect(await mountsOf(page)).toBe(2);
		} finally {
			await session.close();
		}
	}, 120_000);

	/* The data request is redirected: the session ended, and the route
	 * now sends everyone elsewhere. Props that came back from somewhere
	 * else must not be put into this page. The whole-page refresh
	 * follows the redirect, as a reload would. */
	test('follows a redirect instead of applying another page’s data', async () => {
		const session = await openItems('/expiring');
		try {
			const { page } = session;

			await page.click('#add');
			await page.waitForFunction(() => location.pathname === '/items', {
				timeout: 30_000
			});
			await waitForItems(page, 2, true);

			expect(await itemTexts(page)).toEqual(['item 1', 'item 2']);
		} finally {
			await session.close();
		}
	}, 120_000);
});
