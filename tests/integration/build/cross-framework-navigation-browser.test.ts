import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import type { Page } from 'playwright';
import { build } from '../../../src/core/build';
import { enableCspNonces } from '../../../src/core/cspNonce';
import { runWithAbsoluteRequest } from '../../../src/core/requestContext';
import {
	resetSecureHeaders,
	securityHeadersFor
} from '../../../src/plugins/secureHeaders';
import { handleReactPageRequest } from '../../../src/react/pageHandler';
import { handleSveltePageRequest } from '../../../src/svelte/pageHandler';
import { openPage, type BrowserSession } from '../../helpers/browser';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

/* Cross-framework document navigation (src/client/navigation.ts), end to
 * end: a production build with a React page and a Svelte page, served by
 * the real page handlers and driven in Chromium.
 *
 *  - a <Link> from the React page to the Svelte page (and back) swaps the
 *    page in place: no document load, the target hydrates, its styles
 *    replace the old page's;
 *  - an island store (createIslandStore) keeps its value across the swaps,
 *    even though each page's bundle has its own copy of the store module;
 *  - back / forward move between the two pages, restoring scroll;
 *  - with the Navigation API missing, the history fallback does the same;
 *  - under secureHeaders() (per-request nonce + 'strict-dynamic') the
 *    swapped-in page runs its scripts with no CSP violation. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const fixtureRoot = join(
	repoRoot,
	'.test-builds',
	`cross-framework-navigation-${process.pid}`
);
// The Svelte <Link> from the published router (dist/svelte/router), as an
// app gets it; see svelte-router-browser.test.ts.
const routerDir = relative(
	join(fixtureRoot, 'svelte', 'pages'),
	join(repoRoot, 'dist', 'svelte', 'router')
);

const COUNTER_STORE = `import { createIslandStore } from '@absolutejs/absolute/client';

export const counterStore = createIslandStore(
	'cross-framework-counter',
	{ count: 0 },
	(set) => ({
		increment: () => set((state) => ({ count: state.count + 1 }))
	})
);
`;

const REACT_PAGE = `import { useEffect, useState } from 'react';
import { enableNavigation } from '@absolutejs/absolute/client/navigation';
import { useIslandStore } from '@absolutejs/absolute/react/hooks';
import { Link } from '@absolutejs/absolute/react/router';
import { counterStore } from '../../shared/counterStore';

export const ReactNav = ({ cssPath }: { cssPath?: string }) => {
	const count = useIslandStore(counterStore, (state) => state.count);
	const [hydrated, setHydrated] = useState(false);
	useEffect(() => {
		enableNavigation();
		setHydrated(true);
	}, []);

	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<title>React page</title>
				{cssPath ? <link rel="stylesheet" href={cssPath} /> : null}
			</head>
			<body>
				<main id="react-page" data-hydrated={hydrated ? 'true' : 'false'}>
					<nav className="fixed-nav">
						<Link href="/svelte" id="to-svelte" prefetch="none">
							Svelte
						</Link>
					</nav>
					<h1 className="react-styled">React page</h1>
					<button
						id="react-increment"
						onClick={() => counterStore.getState().increment()}
						type="button"
					>
						increment
					</button>
					<span id="react-count">{count}</span>
					<div className="tall">tall React content</div>
				</main>
			</body>
		</html>
	);
};
`;

const SVELTE_PAGE = `<script lang="ts">
	import { onMount } from 'svelte';
	import Link from '${routerDir}/Link.svelte';
	import { enableNavigation } from '@absolutejs/absolute/client/navigation';
	import { useIslandStore } from '@absolutejs/absolute/svelte';
	import { counterStore } from '../../shared/counterStore';

	let { cssPath }: { cssPath?: string } = $props();
	const count = useIslandStore(counterStore, (state) => state.count);
	let hydrated = $state(false);

	onMount(() => {
		enableNavigation();
		hydrated = true;
	});
</script>

<svelte:head>
	<meta charset="utf-8" />
	<title>Svelte page</title>
	<meta name="description" content="Svelte page" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	{#if cssPath}<link rel="stylesheet" href={cssPath} type="text/css" />{/if}
</svelte:head>

<main id="svelte-page" data-hydrated={hydrated ? 'true' : 'false'}>
	<nav class="fixed-nav">
		<Link to="/react" id="to-react" prefetch="none">React</Link>
	</nav>
	<h1 class="svelte-styled scoped-title">Svelte page</h1>
	<button id="svelte-increment" type="button" onclick={() => counterStore.getState().increment()}>
		increment
	</button>
	<span id="svelte-count">{$count}</span>
	<div class="tall">tall Svelte content</div>
</main>

<style>
	.scoped-title {
		letter-spacing: 3px;
	}
</style>
`;

const REACT_CSS = `.react-styled { color: rgb(200, 0, 0); }
.fixed-nav { position: fixed; top: 0; right: 0; background: white; }
.tall { height: 4000px; }
`;

const SVELTE_CSS = `.svelte-styled { color: rgb(0, 0, 200); }
.fixed-nav { position: fixed; top: 0; right: 0; background: white; }
.tall { height: 4000px; }
`;

type ServedApp = { baseUrl: string; stop: () => void };
type ReactPage = (props: { cssPath?: string }) => unknown;

let plain: ServedApp | undefined;
let secure: ServedApp | undefined;

const contentType = (path: string) => {
	if (path.endsWith('.js')) return 'text/javascript';
	if (path.endsWith('.css')) return 'text/css';

	return 'application/octet-stream';
};

const isReactPage = (value: unknown): value is ReactPage =>
	typeof value === 'function';

const createApp = (
	buildDir: string,
	manifest: Record<string, string>,
	Page: ReactPage
) => {
	const renderPage = (request: Request) => {
		const { pathname } = new URL(request.url);
		if (pathname === '/react') {
			return handleReactPageRequest({
				index: manifest.ReactNavIndex ?? '',
				Page,
				props: { cssPath: manifest.ReactNavCSS },
				request
			});
		}
		if (pathname === '/svelte') {
			return handleSveltePageRequest({
				indexPath: manifest.SvelteNavIndex ?? '',
				pagePath: manifest.SvelteNav ?? '',
				props: { cssPath: manifest.SvelteNavCSS },
				request
			});
		}

		return new Response('not found', { status: 404 });
	};

	return async (request: Request) => {
		const { pathname } = new URL(request.url);
		if (extname(pathname) === '') return renderPage(request);
		const filePath = join(buildDir, pathname);
		if (!existsSync(filePath)) return new Response(null, { status: 404 });

		return new Response(Bun.file(filePath), {
			headers: { 'Content-Type': contentType(filePath) }
		});
	};
};

const serve = (handler: (request: Request) => Promise<Response>) => {
	const server = Bun.serve({ fetch: handler, port: 0 });

	return {
		baseUrl: `http://localhost:${server.port}`,
		stop: () => server.stop(true)
	};
};

/* secureHeaders() as the Elysia plugin applies it: the page renders inside
 * the request's context (so every inline script gets its nonce) and the
 * response carries the matching Content-Security-Policy. */
const withSecureHeaders =
	(handler: (request: Request) => Promise<Response>) =>
	async (request: Request) => {
		const response = await runWithAbsoluteRequest(request, () =>
			handler(request)
		);
		const headers = new Headers(response.headers);
		for (const [name, value] of Object.entries(
			securityHeadersFor(request)
		)) {
			headers.set(name, value);
		}

		return new Response(response.body, {
			headers,
			status: response.status
		});
	};

beforeAll(async () => {
	await ensureDistBuild();
	const write = async (path: string, content: string) => {
		await mkdir(join(fixtureRoot, path, '..'), { recursive: true });
		await writeFile(join(fixtureRoot, path), content);
	};
	await write('shared/counterStore.ts', COUNTER_STORE);
	await write('react/pages/ReactNav.tsx', REACT_PAGE);
	await write('svelte/pages/SvelteNav.svelte', SVELTE_PAGE);
	await write('styles/react-nav.css', REACT_CSS);
	await write('styles/svelte-nav.css', SVELTE_CSS);

	const rel = (path: string) =>
		relative(process.cwd(), join(fixtureRoot, path));
	const result = await build({
		buildDirectory: rel('build'),
		mode: 'production',
		options: { throwOnError: true },
		reactDirectory: rel('react'),
		stylesConfig: rel('styles'),
		svelteDirectory: rel('svelte')
	});
	const manifest = result?.manifest ?? {};
	const pageModule: unknown = await import(
		join(fixtureRoot, 'react', 'pages', 'ReactNav.tsx')
	);
	const Page: unknown =
		typeof pageModule === 'object' && pageModule !== null
			? Reflect.get(pageModule, 'ReactNav')
			: undefined;
	if (!isReactPage(Page)) throw new Error('ReactNav page did not load');

	const handler = createApp(join(fixtureRoot, 'build'), manifest, Page);
	enableCspNonces();
	plain = serve(handler);
	secure = serve(withSecureHeaders(handler));
}, 240_000);

afterAll(async () => {
	plain?.stop();
	secure?.stop();
	resetSecureHeaders();
	await rm(fixtureRoot, { force: true, recursive: true });
});

const baseUrlOf = (app: ServedApp | undefined) => {
	if (!app) throw new Error('fixture app is not running');

	return app.baseUrl;
};

type PageObservations = {
	documentLoads: string[];
	errors: string[];
	scripts: string[];
};

const waitHydrated = (page: Page, selector: string) =>
	page.waitForSelector(`${selector}[data-hydrated="true"]`, {
		timeout: 15_000
	});

const withPage = async (
	app: ServedApp | undefined,
	path: string,
	run: (page: Page, seen: PageObservations) => Promise<void>,
	options: { withoutNavigationApi?: boolean } = {}
) => {
	const seen: PageObservations = { documentLoads: [], errors: [], scripts: [] };
	const session: BrowserSession = await openPage(
		`${baseUrlOf(app)}${path}`,
		{ waitUntil: 'load' }
	);
	try {
		const { page } = session;
		if (options.withoutNavigationApi) {
			await page.addInitScript(() => {
				Object.defineProperty(window, 'navigation', {
					configurable: true,
					value: undefined
				});
			});
			await page.reload({ waitUntil: 'load' });
		}
		page.on('pageerror', (error) => seen.errors.push(error.message));
		page.on('console', (message) => {
			if (message.type() === 'error') seen.errors.push(message.text());
		});
		page.on('request', (request) => {
			if (request.resourceType() === 'document') {
				seen.documentLoads.push(request.url());
			}
			if (request.resourceType() === 'script') {
				seen.scripts.push(request.url());
			}
		});
		await waitHydrated(page, path === '/react' ? '#react-page' : '#svelte-page');
		// Survives a soft navigation, gone after a real page load.
		await page.evaluate(() => {
			Reflect.set(window, '__sameDocument', true);
			const violations: string[] = [];
			Reflect.set(window, '__cspViolations', violations);
			document.addEventListener('securitypolicyviolation', (event) => {
				violations.push(`${event.violatedDirective} ${event.blockedURI}`);
			});
		});
		await run(page, seen);
	} finally {
		await session.close();
	}
};

const sameDocument = (page: Page) =>
	page.evaluate(() => Reflect.get(window, '__sameDocument') === true);

const textOf = async (page: Page, selector: string) =>
	(await page.locator(selector).textContent())?.trim();

const colorOf = (page: Page, selector: string) =>
	page.evaluate(
		(target) => {
			const element = document.querySelector(target);

			return element ? getComputedStyle(element).color : null;
		},
		selector
	);

const stylesheetHrefs = (page: Page) =>
	page.evaluate(() =>
		Array.from(
			document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')
		).map((link) => new URL(link.href).pathname)
	);

const waitForText = (page: Page, selector: string, text: string) =>
	page.waitForFunction(
		({ target, expected }) =>
			document.querySelector(target)?.textContent?.trim() === expected,
		{ expected: text, target: selector },
		{ timeout: 10_000 }
	);

const pathnameOf = (page: Page) => new URL(page.url()).pathname;

/* Remember the first `selector` element the swap inserts (the server's
 * markup, before any script runs). If the framework hydrated it, the same
 * element is still in the page; a client re-render would replace it. */
const trackSwappedElement = (page: Page, selector: string) =>
	page.evaluate((target) => {
		Reflect.deleteProperty(window, '__swapped');
		const observer = new MutationObserver(() => {
			const element = document.querySelector(target);
			if (!element) return;
			Reflect.set(window, '__swapped', element);
			observer.disconnect();
		});
		observer.observe(document, { childList: true, subtree: true });
	}, selector);

const keptSwappedElement = (page: Page, selector: string) =>
	page.evaluate(
		(target) =>
			Reflect.get(window, '__swapped') === document.querySelector(target),
		selector
	);

const headCount = (page: Page, selector: string) =>
	page.evaluate((target) => document.querySelectorAll(target).length, selector);

const roundTrip = async (page: Page, seen: PageObservations) => {
	for (let click = 0; click < 3; click += 1) {
		await page.click('#react-increment');
	}
	await waitForText(page, '#react-count', '3');

	await trackSwappedElement(page, '#svelte-page');
	await page.click('#to-svelte');
	await waitHydrated(page, '#svelte-page');
	// Svelte hydrated the server markup (body and <svelte:head>) instead of
	// discarding it and mounting again.
	expect(await keptSwappedElement(page, '#svelte-page')).toBe(true);
	expect(await headCount(page, 'head title')).toBe(1);
	expect(await headCount(page, 'link[rel="stylesheet"]')).toBe(1);
	expect(pathnameOf(page)).toBe('/svelte');
	expect(await sameDocument(page)).toBe(true);
	expect(await page.locator('#react-page').count()).toBe(0);
	expect(await page.title()).toBe('Svelte page');
	// The store kept the value the React page gave it.
	await waitForText(page, '#svelte-count', '3');
	await page.click('#svelte-increment');
	await waitForText(page, '#svelte-count', '4');

	await trackSwappedElement(page, '#react-page');
	await page.click('#to-react');
	await waitHydrated(page, '#react-page');
	expect(await keptSwappedElement(page, '#react-page')).toBe(true);
	expect(await headCount(page, 'head title')).toBe(1);
	expect(await headCount(page, 'link[rel="stylesheet"]')).toBe(1);
	expect(pathnameOf(page)).toBe('/react');
	expect(await sameDocument(page)).toBe(true);
	await waitForText(page, '#react-count', '4');
	await page.click('#react-increment');
	await waitForText(page, '#react-count', '5');

	// The revisited React page re-ran its hydration index under a fresh
	// URL (a module evaluates once per document).
	expect(seen.scripts.some((url) => url.includes('absolute-nav='))).toBe(
		true
	);
	expect(seen.documentLoads).toEqual([]);
};

describe('cross-framework navigation', () => {
	test('React → Svelte → React through <Link> swaps the page in place', async () => {
		await withPage(plain, '/react', async (page, seen) => {
			await roundTrip(page, seen);
			expect(seen.errors).toEqual([]);
		});
	}, 90_000);

	test("each page's stylesheets replace the other's", async () => {
		await withPage(plain, '/react', async (page) => {
			expect(await colorOf(page, '.react-styled')).toBe('rgb(200, 0, 0)');

			await page.click('#to-svelte');
			await waitHydrated(page, '#svelte-page');
			const svelteSheets = await stylesheetHrefs(page);
			expect(svelteSheets.some((href) => href.includes('svelte-nav'))).toBe(
				true
			);
			expect(svelteSheets.some((href) => href.includes('react-nav'))).toBe(
				false
			);
			expect(await colorOf(page, '.svelte-styled')).toBe('rgb(0, 0, 200)');
			// The Svelte component's own (inline, scoped) CSS applies too.
			expect(
				await page.evaluate(
					() =>
						getComputedStyle(
							document.querySelector('.scoped-title') ?? document.body
						).letterSpacing
				)
			).toBe('3px');

			await page.click('#to-react');
			await waitHydrated(page, '#react-page');
			const reactSheets = await stylesheetHrefs(page);
			expect(reactSheets.some((href) => href.includes('react-nav'))).toBe(
				true
			);
			expect(reactSheets.some((href) => href.includes('svelte-nav'))).toBe(
				false
			);
			expect(await colorOf(page, '.react-styled')).toBe('rgb(200, 0, 0)');
			expect(await page.locator('.scoped-title').count()).toBe(0);
		});
	}, 90_000);

	test('back and forward move between the pages and restore scroll', async () => {
		await withPage(plain, '/react', async (page, seen) => {
			await page.evaluate(() => window.scrollTo(0, 1200));
			await page.waitForFunction(() => window.scrollY === 1200);
			await Bun.sleep(100);

			await page.click('#to-svelte');
			await waitHydrated(page, '#svelte-page');
			expect(await page.evaluate(() => window.scrollY)).toBe(0);

			await page.goBack();
			await waitHydrated(page, '#react-page');
			expect(pathnameOf(page)).toBe('/react');
			await page.waitForFunction(() => window.scrollY === 1200, undefined, {
				timeout: 5_000
			});

			await page.goForward();
			await waitHydrated(page, '#svelte-page');
			expect(pathnameOf(page)).toBe('/svelte');

			await page.goBack();
			await waitHydrated(page, '#react-page');
			expect(await sameDocument(page)).toBe(true);
			expect(seen.documentLoads).toEqual([]);
			expect(seen.errors).toEqual([]);
		});
	}, 90_000);

	test('without the Navigation API the history fallback does the same', async () => {
		await withPage(
			plain,
			'/react',
			async (page, seen) => {
				expect(await page.evaluate(() => 'navigation' in window && window.navigation === undefined)).toBe(true);
				await roundTrip(page, seen);
				await page.goBack();
				await waitHydrated(page, '#svelte-page');
				await waitForText(page, '#svelte-count', '5');
				await page.goBack();
				await waitHydrated(page, '#react-page');
				expect(await sameDocument(page)).toBe(true);
				expect(seen.documentLoads).toEqual([]);
				expect(seen.errors).toEqual([]);
			},
			{ withoutNavigationApi: true }
		);
	}, 90_000);

	test('under secureHeaders() the swapped page runs with no CSP violation', async () => {
		await withPage(secure, '/react', async (page, seen) => {
			const policy = (await page.request.get(page.url())).headers()[
				'content-security-policy'
			];
			expect(policy).toContain("'strict-dynamic'");
			await roundTrip(page, seen);
			expect(
				await page.evaluate(() => Reflect.get(window, '__cspViolations'))
			).toEqual([]);
			expect(seen.errors).toEqual([]);
		});
	}, 90_000);

	test('a link opted out with data-absolute-navigation="off" loads the page', async () => {
		await withPage(plain, '/react', async (page, seen) => {
			await page.evaluate(() =>
				document
					.querySelector('#to-svelte')
					?.setAttribute('data-absolute-navigation', 'off')
			);
			await Promise.all([
				page.waitForEvent('framenavigated'),
				page.click('#to-svelte')
			]);
			await waitHydrated(page, '#svelte-page');
			expect(await sameDocument(page)).toBe(false);
			expect(seen.documentLoads.length).toBe(1);
		});
	}, 90_000);
});
