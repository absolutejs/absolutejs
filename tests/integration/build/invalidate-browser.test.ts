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
						data-action-invalidate=""
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
		if (
			(pathname === '/items' || pathname === '/plain') &&
			isReactPage(Page)
		)
			return cacheable(
				await handleReactPageRequest({
					index: manifest.InvalidatePageIndex ?? '',
					Page,
					props: { items: [...items], layer: pathname === '/items' },
					request
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

const waitForItems = (page: Page, count: number) =>
	page.waitForFunction(
		(expected) =>
			document.querySelectorAll('#items li').length === expected &&
			Reflect.get(window, '__pageHydrated') === true,
		count,
		{ timeout: 30_000 }
	);

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
			await page.waitForFunction(
				() => Reflect.get(window, '__outcome') === 'swapped'
			);
		} finally {
			await session.close();
		}
	}, 120_000);

	test('keeps the address, the history entry and the scroll position', async () => {
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
			expect(after.scrollY).toBe(400);
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

	/* What it costs, pinned so that it is a decision and not a surprise:
	 * the page is mounted again, so its own component state starts over. */
	test('mounts the page again: component state starts over', async () => {
		const session = await openItems('/items');
		try {
			const { page } = session;
			await page.click('#clicks');
			await page.click('#clicks');
			expect(await page.locator('#clicks').textContent()).toBe('2');

			await page.click('#add');
			await waitForItems(page, 2);

			expect(await page.locator('#clicks').textContent()).toBe('0');
		} finally {
			await session.close();
		}
	}, 120_000);

	/* `data-action-invalidate` on an enhanced form: the action changes
	 * the data, and the page shows it without the app writing a line. */
	test('an enhanced form marked for it refreshes the page on success', async () => {
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

	test('without the navigation layer it reloads the page', async () => {
		const session = await openItems('/plain');
		try {
			const { page } = session;

			await Promise.all([
				page.waitForEvent('load', { timeout: 30_000 }),
				page.click('#add')
			]);
			await waitForItems(page, 2);

			expect(await itemTexts(page)).toEqual(['item 1', 'item 2']);
			expect(
				await page.evaluate(() => Reflect.get(window, '__sameDocument'))
			).toBeUndefined();
		} finally {
			await session.close();
		}
	}, 120_000);
});
