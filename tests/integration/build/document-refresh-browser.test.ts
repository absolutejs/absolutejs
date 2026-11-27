import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Page } from 'playwright';
import { openPage, type BrowserSession } from '../../helpers/browser';

/* `invalidate()` on a page with no framework — plain HTML, and HTML with
 * HTMX — in a real browser.
 *
 * Such a page has no props to be handed. Its state is the document: what
 * was typed, what is open, what a script attached. The document on
 * screen is morphed into a fresh copy of itself, and everything asserted
 * here is something a visitor would lose if the body were simply
 * replaced, which is what a refresh used to do.
 *
 * The server writes its pages by hand, so the list in them can change
 * between requests. `invalidate` is bundled from this checkout's sources
 * and served to the page. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const HTMX = join(repoRoot, 'src', 'cli', 'htmx', 'htmx.min.js');
const INVALIDATE = resolve(repoRoot, 'src/client/invalidate').replace(
	/\\/g,
	'/'
);

type ServedApp = { baseUrl: string; items: string[]; stop: () => void };

let app: ServedApp | undefined;
let work = '';

const html = (body: string, extraHead = '') =>
	new Response(
		`<!doctype html><html lang="en"><head><title>Items</title><link rel="stylesheet" href="/style.css">${extraHead}</head><body>${body}</body></html>`,
		{ headers: { 'content-type': 'text/html; charset=utf-8' } }
	);

/* What every page here shares. The script is the page's own behaviour:
 * it runs once, attaches listeners, and keeps a count of its own. */
const pageBody = (items: string[], rows: (item: string) => string) => `
	<main id="page">
		<h1 id="heading">${items.length} items</h1>
		<input id="note" type="text">
		<details id="more"><summary>More</summary><p id="detail">${items.length} in the list</p></details>
		<button id="add" type="button">add</button>
		<button id="local" type="button">local</button>
		<span id="local-count" data-absolute-preserve>0</span>
		<ul id="items">${items.map(rows).join('')}</ul>
		<div id="out"></div>
	</main>
	<script type="module">
		import '/invalidate.js';
		let local = 0;
		Reflect.set(window, '__scriptRuns', Number(Reflect.get(window, '__scriptRuns') ?? 0) + 1);
		document.getElementById('local').addEventListener('click', () => {
			local += 1;
			document.getElementById('local-count').textContent = String(local);
		});
		document.getElementById('add').addEventListener('click', async () => {
			await fetch('/api/add', { method: 'POST' });
			const invalidate = Reflect.get(window, '__absoluteInvalidate');
			Reflect.set(window, '__outcome', await invalidate());
		});
		Reflect.set(window, '__pageReady', true);
	</script>`;

const createApp = (items: string[], invalidateBundle: string) => {
	const plainRow = (item: string) => `<li id="${item}">${item}</li>`;
	const htmxRow = (item: string) =>
		`<li id="${item}">${item} <button class="load" hx-get="/fragment/${item}" hx-target="#out">load</button></li>`;

	return async (request: Request) => {
		const { pathname } = new URL(request.url);
		if (pathname === '/api/add' && request.method === 'POST') {
			// Newest first: an item arriving at the TOP is the case a
			// careless patch gets wrong.
			items.unshift(`item-${items.length + 1}`);

			return Response.json({ count: items.length });
		}
		if (pathname === '/html') return html(pageBody(items, plainRow));
		if (pathname === '/htmx')
			return html(
				pageBody(items, htmxRow),
				'<script src="/htmx.js"></script>'
			);
		if (pathname.startsWith('/fragment/'))
			return new Response(
				`<p id="loaded">loaded ${pathname.slice('/fragment/'.length)}</p>`,
				{ headers: { 'content-type': 'text/html' } }
			);
		if (pathname === '/invalidate.js')
			return new Response(invalidateBundle, {
				headers: { 'content-type': 'text/javascript' }
			});
		if (pathname === '/htmx.js')
			return new Response(Bun.file(HTMX), {
				headers: { 'content-type': 'text/javascript' }
			});
		if (pathname === '/style.css')
			return new Response('#heading{color:rgb(0,0,200)}', {
				headers: { 'content-type': 'text/css' }
			});

		return new Response(null, {
			status: pathname === '/favicon.ico' ? 204 : 404
		});
	};
};

const bundleInvalidate = async () => {
	const entry = join(work, 'invalidate-entry.ts');
	await writeFile(
		entry,
		`import { invalidate } from '${INVALIDATE}';\nReflect.set(window, '__absoluteInvalidate', invalidate);\n`
	);
	const built = await Bun.build({
		entrypoints: [entry],
		format: 'esm',
		target: 'browser'
	});
	const [output] = built.outputs;
	if (!built.success || !output)
		throw new Error('could not bundle invalidate for the page');

	return output.text();
};

beforeAll(async () => {
	work = await mkdtemp(join(tmpdir(), 'absolute-document-refresh-'));
	const items: string[] = [];
	const server = Bun.serve({
		fetch: createApp(items, await bundleInvalidate()),
		port: 0
	});
	app = {
		baseUrl: `http://localhost:${server.port}`,
		items,
		stop: () => server.stop(true)
	};
}, 120_000);

afterAll(async () => {
	app?.stop();
	if (work) await rm(work, { force: true, recursive: true });
});

const served = () => {
	if (!app) throw new Error('fixture app is not running');

	return app;
};

type PageLog = { entries: string[] };

const openItems = async (path: string, log: PageLog) => {
	const { baseUrl, items } = served();
	items.splice(0, items.length, 'item-1');
	const record = (page: Page) => {
		page.on('pageerror', (error) => {
			log.entries.push(`pageerror: ${error.message}`);
		});
		page.on('console', (message) => {
			if (message.type() === 'error')
				log.entries.push(
					`console.error: ${message.text()} (${message.location().url})`
				);
		});
	};
	const session: BrowserSession = await openPage(`${baseUrl}${path}`, {
		onPage: record,
		waitUntil: 'load'
	});
	await session.page.waitForFunction(
		() => Reflect.get(window, '__pageReady') === true,
		undefined,
		{ timeout: 30_000 }
	);
	await session.page.evaluate(() => {
		Reflect.set(window, '__sameDocument', true);
	});

	return session;
};

const itemTexts = (page: Page) =>
	page.locator('#items li').evaluateAll((rows) => rows.map((row) => row.id));

const read = (page: Page, name: string) =>
	page.evaluate((key) => Reflect.get(window, key), name);

const refreshed = async (page: Page, count: number) => {
	await page.waitForFunction(
		(expected) =>
			document.querySelectorAll('#items li').length === expected,
		count,
		{ timeout: 30_000 }
	);
	await page.waitForFunction(
		() => Reflect.get(window, '__outcome') !== undefined,
		undefined,
		{ timeout: 30_000 }
	);
};

describe.each([
	['an HTML page', '/html'],
	['an HTMX page', '/htmx']
] as const)('invalidate() on %s', (_kind, path) => {
	test('shows the new data, in the same document, with the page’s script run once', async () => {
		const log: PageLog = { entries: [] };
		const session = await openItems(path, log);
		try {
			const { page } = session;

			await page.click('#add');
			await refreshed(page, 2);

			// The new item is first, where the server put it.
			expect(await itemTexts(page)).toEqual(['item-2', 'item-1']);
			expect(await page.locator('#heading').textContent()).toBe(
				'2 items'
			);
			expect(await read(page, '__outcome')).toBe('updated');
			expect(await read(page, '__sameDocument')).toBe(true);
			expect(await read(page, '__scriptRuns')).toBe(1);
			expect(log.entries).toEqual([]);
		} finally {
			await session.close();
		}
	}, 120_000);

	test('keeps what was typed, what was opened and what the script attached', async () => {
		const log: PageLog = { entries: [] };
		const session = await openItems(path, log);
		try {
			const { page } = session;
			await page.fill('#note', 'half-typed');
			await page.click('#more summary');
			await page.click('#local');
			await page.click('#local');

			await page.click('#add');
			await refreshed(page, 2);

			expect(await page.inputValue('#note')).toBe('half-typed');
			expect(
				await page
					.locator('#more')
					.evaluate((details) => details.hasAttribute('open'))
			).toBe(true);
			// Inside the open element, the content is the new one.
			expect(await page.locator('#detail').textContent()).toBe(
				'2 in the list'
			);
			// The script's listener is still attached, and its count
			// carries on from where it was.
			await page.click('#local');
			expect(await page.locator('#local-count').textContent()).toBe('3');
			expect(log.entries).toEqual([]);
		} finally {
			await session.close();
		}
	}, 120_000);

	test('rows that were already there are the same elements', async () => {
		const log: PageLog = { entries: [] };
		const session = await openItems(path, log);
		try {
			const { page } = session;
			await page.evaluate(() => {
				const row = document.getElementById('item-1');
				if (row) Reflect.set(row, '__marked', true);
			});

			await page.click('#add');
			await refreshed(page, 2);

			expect(
				await page.evaluate(() =>
					Reflect.get(
						document.getElementById('item-1') ?? {},
						'__marked'
					)
				)
			).toBe(true);
		} finally {
			await session.close();
		}
	}, 120_000);
});

describe('invalidate() on an HTMX page', () => {
	/* The row for the new item arrived in the refresh, so HTMX has never
	 * seen its `hx-get`. Unless it is asked to look again, the button
	 * does nothing. */
	test('markup that arrived in the refresh works with HTMX', async () => {
		const log: PageLog = { entries: [] };
		const session = await openItems('/htmx', log);
		try {
			const { page } = session;
			await page.click('#add');
			await refreshed(page, 2);

			await page.click('#item-2 .load');
			await page.waitForSelector('#loaded', { timeout: 30_000 });

			expect(await page.locator('#loaded').textContent()).toBe(
				'loaded item-2'
			);
			expect(log.entries).toEqual([]);
		} finally {
			await session.close();
		}
	}, 120_000);

	/* What HTMX put on the page since it loaded is not in the server's
	 * fresh copy, and goes. That is inherent: the copy is the page as
	 * the server renders it now. Pinned so it is known, not found. */
	test('content HTMX loaded earlier is replaced by the server’s copy', async () => {
		const log: PageLog = { entries: [] };
		const session = await openItems('/htmx', log);
		try {
			const { page } = session;
			await page.click('#item-1 .load');
			await page.waitForSelector('#loaded', { timeout: 30_000 });

			await page.click('#add');
			await refreshed(page, 2);

			expect(await page.locator('#loaded').count()).toBe(0);
		} finally {
			await session.close();
		}
	}, 120_000);
});
