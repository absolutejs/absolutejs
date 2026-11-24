import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import type { Page } from 'playwright';
import { build } from '../../../src/core/build';
import { handleReactPageRequest } from '../../../src/react/pageHandler';
import { handleSveltePageRequest } from '../../../src/svelte/pageHandler';
import { openPage, type BrowserSession } from '../../helpers/browser';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

/* Navigations that are not link clicks — navigation plan phase 4.
 *
 * The layer intercepts clicks and history traversals, which is every
 * navigation a user makes by following a link. It is not every navigation
 * a page makes: a form submission and a `location.assign()` both bypass
 * the click listener entirely and reload the document, so an app that
 * submits a search form loses its island state and pays for a fresh
 * document on a navigation that could have been a swap.
 *
 * Where the Navigation API exists, its `navigate` event sees all of them,
 * and `intercept()` is how a page takes one over. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const fixtureRoot = join(
	repoRoot,
	'.test-builds',
	`navigate-event-${process.pid}`
);

const REACT_PAGE = `import { useEffect } from 'react';
import { enableNavigation, navigateDocument } from '@absolutejs/absolute/client/navigation';

export function NavEventReact() {
	useEffect(() => {
		enableNavigation();
	}, []);

	return (
		<html lang="en">
			<head>
				<title>React page</title>
			</head>
			<body>
				<div id="react-page" data-hydrated="true">
					<form action="/svelte" method="get" id="search">
						<input type="text" name="q" defaultValue="hello" />
						<button type="submit" id="search-submit">search</button>
					</form>
					<form
						action="/svelte"
						method="get"
						id="search-off"
						data-absolute-navigation="off"
					>
						<input type="text" name="q" defaultValue="optedout" />
						<button type="submit" id="search-off-submit">search</button>
					</form>
					<form action="/posted" method="post" id="post">
						<input type="text" name="q" defaultValue="posted" />
						<button type="submit" id="post-submit">post</button>
					</form>
					<button
						type="button"
						id="assign"
						onClick={() => window.location.assign('/svelte?q=assigned')}
					>
						assign
					</button>
					<button
						type="button"
						id="programmatic"
						onClick={() => void navigateDocument('/svelte?q=programmatic')}
					>
						navigateDocument
					</button>
					<a href="/svelte?q=clicked" id="to-svelte">svelte</a>
					<a
						href="/svelte?q=opted-out"
						id="to-svelte-off"
						data-absolute-navigation="off"
					>
						svelte, the slow way
					</a>
				</div>
			</body>
		</html>
	);
}
`;

const SVELTE_PAGE = `<script lang="ts">
	import { onMount } from 'svelte';
	import { enableNavigation } from '@absolutejs/absolute/client/navigation';

	let query = $state('');

	onMount(() => {
		enableNavigation();
		query = new URL(window.location.href).searchParams.get('q') ?? '';
		Reflect.set(window, '__svelteHydrated', true);
	});
</script>

<svelte:head><title>Svelte page</title></svelte:head>

<div id="svelte-page" data-hydrated="true">
	<p id="query">{query}</p>
	<a href="/react" id="to-react">react</a>
</div>
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

	return 'application/octet-stream';
};

const POSTED_PAGE = `<!doctype html>
<html lang="en"><head><title>Posted</title></head>
<body><div id="posted-page">posted</div></body></html>`;

const createApp = (
	buildDir: string,
	manifest: Record<string, string>,
	Page: unknown
) => {
	return async (request: Request) => {
		const { pathname } = new URL(request.url);
		if (pathname === '/posted')
			return new Response(POSTED_PAGE, {
				headers: { 'Content-Type': 'text/html; charset=utf-8' }
			});
		if (pathname === '/react' && isReactPage(Page))
			return handleReactPageRequest({
				index: manifest.NavEventReactIndex ?? '',
				Page,
				props: {},
				request
			});
		if (pathname === '/svelte')
			return handleSveltePageRequest({
				indexPath: manifest.NavEventSvelteIndex ?? '',
				pagePath: manifest.NavEventSvelte ?? '',
				request
			});
		if (extname(pathname) === '')
			return new Response('not found', { status: 404 });
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
	await mkdir(join(fixtureRoot, 'svelte', 'pages'), { recursive: true });
	await writeFile(
		join(fixtureRoot, 'react', 'pages', 'NavEventReact.tsx'),
		REACT_PAGE
	);
	await writeFile(
		join(fixtureRoot, 'svelte', 'pages', 'NavEventSvelte.svelte'),
		SVELTE_PAGE
	);
	const rel = (path: string) =>
		relative(process.cwd(), join(fixtureRoot, path));
	const result = await build({
		buildDirectory: rel('build'),
		mode: 'production',
		options: { throwOnError: true },
		reactDirectory: rel('react'),
		svelteDirectory: rel('svelte')
	});
	const pageModule: unknown = await import(
		join(fixtureRoot, 'react', 'pages', 'NavEventReact.tsx')
	);
	const Page: unknown =
		typeof pageModule === 'object' && pageModule !== null
			? Reflect.get(pageModule, 'NavEventReact')
			: undefined;
	const server = Bun.serve({
		fetch: createApp(
			join(fixtureRoot, 'build'),
			result?.manifest ?? {},
			Page
		),
		port: 0
	});
	app = {
		baseUrl: `http://localhost:${server.port}`,
		stop: () => server.stop(true)
	};
}, 300_000);

afterAll(async () => {
	app?.stop();
	await rm(fixtureRoot, { force: true, recursive: true });
});

const baseUrl = () => {
	if (!app) throw new Error('fixture app is not running');

	return app.baseUrl;
};

type Observations = { documentLoads: string[]; errors: string[] };

const openReact = async (
	run: (page: Page, seen: Observations) => Promise<void>,
	options: { withoutNavigationApi?: boolean } = {}
) => {
	const seen: Observations = { documentLoads: [], errors: [] };
	const session: BrowserSession = await openPage(`${baseUrl()}/react`, {
		waitUntil: 'load'
	});
	try {
		const { page } = session;
		if (options.withoutNavigationApi) {
			// Safari and Firefox, as far as this feature is concerned.
			await page.addInitScript(() => {
				Object.defineProperty(window, 'navigation', {
					configurable: true,
					value: undefined
				});
			});
			await page.reload({ waitUntil: 'load' });
		}
		page.on('pageerror', (error) => seen.errors.push(error.message));
		await page.waitForSelector('#react-page[data-hydrated="true"]', {
			timeout: 20_000
		});
		// Counted after hydration, so the first page's own assets are not in
		// the tally; the marker proves the document itself never reloaded.
		page.on('request', (request) => {
			if (request.resourceType() === 'document')
				seen.documentLoads.push(request.url());
		});
		await page.evaluate(() => Reflect.set(window, '__sameDocument', true));
		await run(page, seen);
	} finally {
		await session.close();
	}
};

const sameDocument = (page: Page) =>
	page.evaluate(() => Reflect.get(window, '__sameDocument') === true);

const svelteArrived = (page: Page) =>
	page.waitForFunction(
		() => Reflect.get(window, '__svelteHydrated') === true,
		undefined,
		{ timeout: 20_000 }
	);

/* The Svelte page reads `?q=` in `onMount` and renders it. Waiting for the
 * hydration flag is not enough to read it: the flag is set in that same
 * `onMount`, and Svelte flushes the state change on a microtask, so
 * reading immediately after the flag catches the empty first render.
 * Waiting for any text and then asserting which text keeps the assertion
 * able to fail — a swap that carried the wrong URL renders the other
 * value, not an empty string. */
const queryShown = async (page: Page) => {
	await page.waitForFunction(
		() =>
			(document.getElementById('query')?.textContent?.trim() ?? '') !== '',
		undefined,
		{ timeout: 10_000 }
	);

	return page.evaluate(() =>
		document.getElementById('query')?.textContent?.trim()
	);
};

describe('a GET form submission', () => {
	test('swaps the page in and keeps the query it submitted', async () => {
		/* The query is the half that makes this more than "it navigated":
		 * the form's own data has to survive into the URL the layer
		 * fetched, and the Svelte page reads it from `location` after
		 * hydration, so a swap that dropped the query or hydrated against
		 * the wrong URL fails here rather than passing quietly. */
		await openReact(async (page, seen) => {
			await page.click('#search-submit');
			await svelteArrived(page);

			expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(
				'/svelte?q=hello'
			);
			expect(await sameDocument(page)).toBe(true);
			expect(await queryShown(page)).toBe('hello');
			expect(seen.documentLoads).toEqual([]);
			expect(seen.errors).toEqual([]);
		});
	}, 240_000);

	test('leaves the back button pointing at the form', async () => {
		await openReact(async (page, seen) => {
			await page.click('#search-submit');
			await svelteArrived(page);
			await page.goBack();
			await page.waitForSelector('#react-page[data-hydrated="true"]', {
				timeout: 20_000
			});

			expect(new URL(page.url()).pathname).toBe('/react');
			expect(await sameDocument(page)).toBe(true);
			expect(seen.documentLoads).toEqual([]);
		});
	}, 240_000);
});

describe('location.assign', () => {
	test('swaps instead of loading a document', async () => {
		await openReact(async (page, seen) => {
			await page.click('#assign');
			await svelteArrived(page);

			expect(await queryShown(page)).toBe('assigned');
			expect(await sameDocument(page)).toBe(true);
			expect(seen.documentLoads).toEqual([]);
			expect(seen.errors).toEqual([]);
		});
	}, 240_000);
});

describe('what the layer still leaves alone', () => {
	test('a POST form submits as a POST, with a document load', async () => {
		/* Deliberate, and the reason is the swap's own shape: it fetches the
		 * target with GET, so intercepting a POST would turn a submission
		 * into a read of the action URL. Asserted rather than assumed,
		 * because the failure mode is silent — the page would look right
		 * and the data would be gone. */
		await openReact(async (page, seen) => {
			await page.click('#post-submit');
			await page.waitForSelector('#posted-page', { timeout: 20_000 });

			expect(new URL(page.url()).pathname).toBe('/posted');
			expect(await sameDocument(page)).toBe(false);
			expect(seen.documentLoads.length).toBeGreaterThan(0);
		});
	}, 240_000);

	test('a form that opted out loads a document', async () => {
		/* `data-absolute-navigation="off"` is read off the form, and
		 * `sourceElement` for a submission is the BUTTON inside it — so
		 * this fails if the check does not climb. */
		await openReact(async (page, seen) => {
			await page.click('#search-off-submit');
			await page.waitForSelector('#svelte-page', { timeout: 20_000 });

			expect(await sameDocument(page)).toBe(false);
			expect(seen.documentLoads.length).toBeGreaterThan(0);
		});
	}, 240_000);

	test('a page’s own pushState is left alone', async () => {
		/* The invariant that keeps this feature from being a disaster, and
		 * the bug it was written after: `history.pushState` fires a
		 * `navigate` event too. The layer's own swap pushes, so without the
		 * same-document check it intercepted its own history write, swapped,
		 * pushed again — Chromium ends that with "Throttling navigation to
		 * prevent the browser from hanging".
		 *
		 * Routers make it worse than a loop: every framework router changes
		 * route by calling `pushState`, so an in-router navigation would be
		 * answered with a full cross-framework document swap. Asserted on a
		 * URL that IS a real page here, so interception would look like
		 * success. */
		await openReact(async (page, seen) => {
			await page.evaluate(() => {
				history.pushState({}, '', '/svelte?q=pushed');
			});
			await page.waitForTimeout(1000);

			expect(new URL(page.url()).search).toBe('?q=pushed');
			// Still the page that pushed: no swap, nothing fetched.
			expect(await page.locator('#react-page').count()).toBe(1);
			expect(await page.locator('#svelte-page').count()).toBe(0);
			expect(seen.documentLoads).toEqual([]);
			expect(seen.errors).toEqual([]);
		});
	}, 240_000);

	test('a link that opted out still loads a document', async () => {
		/* The regression this feature could cause: the click listener
		 * declines an opted-out link WITHOUT preventing the default, so the
		 * browser goes on to fire `navigate` for it. Taking that would make
		 * the opt-out mean nothing in a browser with the Navigation API. */
		await openReact(async (page, seen) => {
			await page.click('#to-svelte-off');
			await page.waitForSelector('#svelte-page', { timeout: 20_000 });

			expect(await sameDocument(page)).toBe(false);
			expect(seen.documentLoads.length).toBeGreaterThan(0);
		});
	}, 240_000);
});

describe('a browser with no Navigation API', () => {
	test('loads a document for a form, and still swaps a link', async () => {
		/* The documented floor, asserted rather than assumed: with no
		 * Navigation API there is no event for a form submission, so it
		 * loads a document — and nothing a LINK does may depend on the API
		 * being there, which is the half that could regress silently. */
		await openReact(
			async (page, seen) => {
				expect(
					await page.evaluate(
						() => Reflect.get(window, 'navigation') === undefined
					)
				).toBe(true);

				await page.click('#to-svelte');
				await svelteArrived(page);

				expect(await queryShown(page)).toBe('clicked');
				expect(await sameDocument(page)).toBe(true);
				expect(seen.documentLoads).toEqual([]);

				await page.click('#to-react');
				await page.waitForSelector('#react-page[data-hydrated="true"]', {
					timeout: 20_000
				});
				await page.click('#search-submit');
				await page.waitForSelector('#svelte-page', { timeout: 20_000 });

				expect(await sameDocument(page)).toBe(false);
				expect(seen.documentLoads.length).toBeGreaterThan(0);
			},
			{ withoutNavigationApi: true }
		);
	}, 240_000);
});

describe('the click and programmatic paths are unchanged', () => {
	test('a plain link and navigateDocument both still swap', async () => {
		await openReact(async (page, seen) => {
			await page.click('#to-svelte');
			await svelteArrived(page);

			expect(await queryShown(page)).toBe('clicked');
			expect(await sameDocument(page)).toBe(true);

			await page.click('#to-react');
			await page.waitForSelector('#react-page[data-hydrated="true"]', {
				timeout: 20_000
			});
			await page.evaluate(() =>
				Reflect.deleteProperty(window, '__svelteHydrated')
			);
			await page.click('#programmatic');
			await svelteArrived(page);

			expect(await queryShown(page)).toBe('programmatic');
			expect(await sameDocument(page)).toBe(true);
			expect(seen.documentLoads).toEqual([]);
			expect(seen.errors).toEqual([]);
		});
	}, 240_000);
});
