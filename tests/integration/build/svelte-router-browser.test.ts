import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import type { Page } from 'playwright';
import { build } from '../../../src/core/build';
import { handleSveltePageRequest } from '../../../src/svelte/pageHandler';
import { openPage, type BrowserSession } from '../../helpers/browser';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

/* The Svelte router's guards, lazy routes and scroll restoration, end to
 * end: a production build of a router page, served by the real Svelte page
 * handler and driven in Chromium.
 *
 *  - a guard redirect is a 302 on a direct request and a client-side
 *    redirect on a <Link> click; a guard that cancels a back navigation
 *    puts the URL back;
 *  - a lazy route ships as its own chunk, requested only when navigated to
 *    or prefetched; its server render holds the real component and the
 *    page hydrates without a pending flash;
 *  - back/forward restores the scroll position, new navigations start at
 *    the top, `#hash` links land on their target and `noScroll` opts out. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const fixtureRoot = join(
	repoRoot,
	'.test-builds',
	`svelte-router-browser-${process.pid}`
);
// The published router (dist/svelte/router), as an app gets it. Inside this
// repo `@absolutejs/absolute/svelte/router/*.svelte` resolves to src/, whose
// `.svelte.ts` rune module only works once the package build compiles it, so
// the components are imported from dist by path; the runtime API comes from
// the same files through the package export.
const routerDir = relative(
	join(fixtureRoot, 'svelte', 'pages'),
	join(repoRoot, 'dist', 'svelte', 'router')
);
const LAZY_MARKER = 'LAZY_PANEL_CHUNK_MARKER';
const SECTION_COUNT = 8;

const ROUTER_PAGE = `<script lang="ts">
	import { onMount } from 'svelte';
	import Router from '${routerDir}/Router.svelte';
	import Route from '${routerDir}/Route.svelte';
	import Link from '${routerDir}/Link.svelte';
	import { beforeNavigate, goto, redirect } from '@absolutejs/absolute/svelte/router';

	let { url }: { url?: string } = $props();
	const sections = Array.from({ length: ${SECTION_COUNT} }, (_, index) => index + 1);

	beforeNavigate(({ type }) => {
		if (type === 'popstate' && Reflect.get(window, '__blockBack') === true) {
			return false;
		}
	});

	onMount(() => {
		Reflect.set(window, '__goto', goto);
		Reflect.set(window, '__hydrated', true);
	});
</script>

<Router {url}>
	<!-- Fixed, so clicking a link never has to scroll the page first. -->
	<nav style="position: fixed; top: 0; right: 0; z-index: 1; background: white">
		<Link to="/app" id="home-link" prefetch="none">Home</Link>
		<Link to="/app/long" id="long-link" prefetch="none">Long</Link>
		<Link to="/app/long#section-5" id="hash-link" prefetch="none">Section 5</Link>
		<Link to="/app/lazy" id="lazy-link" prefetch="hover">Lazy</Link>
		<Link to="/app/slow" id="slow-link" prefetch="none">Slow</Link>
		<Link to="/app/secret" id="secret-link" prefetch="none">Secret</Link>
	</nav>
	<main>
		<Route path="/app">
			{#snippet content()}
				<h1 id="home">Home</h1>
				<div style="height: 3000px">tall home</div>
			{/snippet}
		</Route>
		<Route path="/app/long">
			{#snippet content()}
				<h1 id="long">Long</h1>
				{#each sections as section (section)}
					<section id="section-{section}" style="height: 900px">Section {section}</section>
				{/each}
			{/snippet}
		</Route>
		<Route path="/app/lazy" loader={() => import('../components/LazyPanel.svelte')}>
			{#snippet pending()}<p id="lazy-pending">Loading…</p>{/snippet}
		</Route>
		<Route
			path="/app/slow"
			loader={() =>
				new Promise((done) => setTimeout(done, 400)).then(() => import('../components/SlowPanel.svelte'))}
		>
			{#snippet pending()}<p id="slow-pending">Loading slowly…</p>{/snippet}
		</Route>
		<Route path="/app/secret" guard={() => redirect('/app/login')}>
			{#snippet content()}<h1 id="secret">Secret</h1>{/snippet}
		</Route>
		<Route path="/app/login">
			{#snippet content()}<h1 id="login">Login</h1>{/snippet}
		</Route>
	</main>
</Router>
`;

const LAZY_PANEL = `<script lang="ts">
	let count = $state(0);
	const marker = '${LAZY_MARKER}';
</script>

<section id="lazy-panel" data-marker={marker}>
	<h1>Lazy panel</h1>
	<button id="lazy-count" onclick={() => count++}>count {count}</button>
	<div style="height: 2500px">tall lazy</div>
</section>
`;

const SLOW_PANEL = `<section id="slow-panel"><h1>Slow panel</h1></section>
`;

type ServedApp = { baseUrl: string; stop: () => void };

let served: ServedApp | undefined;
let lazyPanelSource = '';

const contentType = (path: string) => {
	if (path.endsWith('.js')) return 'text/javascript';
	if (path.endsWith('.css')) return 'text/css';

	return 'application/octet-stream';
};

const serveBuild = (buildDir: string, manifest: Record<string, string>) => {
	const port = Number(process.env.SVELTE_ROUTER_TEST_PORT ?? 0);
	const server = Bun.serve({
		fetch: async (request) => {
			const { pathname } = new URL(request.url);
			if (extname(pathname) !== '') {
				const filePath = join(buildDir, pathname);
				if (!existsSync(filePath)) return new Response(null, { status: 404 });

				return new Response(Bun.file(filePath), {
					headers: { 'Content-Type': contentType(filePath) }
				});
			}

			return handleSveltePageRequest({
				indexPath: manifest.RouterAppIndex ?? '',
				pagePath: manifest.RouterApp ?? '',
				request
			});
		},
		port
	});

	return {
		baseUrl: `http://localhost:${server.port}`,
		stop: () => server.stop(true)
	};
};

beforeAll(async () => {
	// The fixture imports the router the way an app does, through the
	// package exports (dist/svelte/router).
	await ensureDistBuild();
	const pagesDir = join(fixtureRoot, 'svelte', 'pages');
	const componentsDir = join(fixtureRoot, 'svelte', 'components');
	await mkdir(pagesDir, { recursive: true });
	await writeFile(join(pagesDir, 'RouterApp.svelte'), ROUTER_PAGE);
	await mkdir(componentsDir, { recursive: true });
	await writeFile(join(componentsDir, 'LazyPanel.svelte'), LAZY_PANEL);
	await writeFile(join(componentsDir, 'SlowPanel.svelte'), SLOW_PANEL);
	lazyPanelSource = LAZY_MARKER;

	const rel = (path: string) => relative(process.cwd(), join(fixtureRoot, path));
	const result = await build({
		buildDirectory: rel('build'),
		mode: 'production',
		options: { throwOnError: true },
		svelteDirectory: rel('svelte')
	});
	served = serveBuild(join(fixtureRoot, 'build'), result?.manifest ?? {});
}, 180_000);

afterAll(async () => {
	served?.stop();
	await rm(fixtureRoot, { force: true, recursive: true });
});

const baseUrl = () => {
	if (!served) throw new Error('fixture app is not running');

	return served.baseUrl;
};

const withPage = async (
	path: string,
	run: (page: Page, scripts: string[]) => Promise<void>
) => {
	const scripts: string[] = [];
	const session: BrowserSession = await openPage(`${baseUrl()}${path}`, {
		waitUntil: 'commit'
	});
	try {
		session.page.on('request', (request) => {
			if (request.resourceType() === 'script') scripts.push(request.url());
		});
		await session.page.waitForFunction(
			() => Reflect.get(window, '__hydrated') === true,
			undefined,
			{ timeout: 15_000 }
		);
		await run(session.page, scripts);
	} finally {
		await session.close();
	}
};

const scriptContains = async (url: string, needle: string) =>
	(await (await fetch(url)).text()).includes(needle);

const pathnameOf = (page: Page) => new URL(page.url()).pathname;

const scrollY = (page: Page) => page.evaluate(() => window.scrollY);

describe('svelte router guards', () => {
	test('a guard redirect is a 302 on a direct request', async () => {
		const response = await fetch(`${baseUrl()}/app/secret`, {
			redirect: 'manual'
		});

		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe('/app/login');
	});

	test('a guard redirect sends a <Link> click to the redirect target', async () => {
		await withPage('/app', async (page) => {
			await page.click('#secret-link');
			await page.waitForSelector('#login', { timeout: 10_000 });

			expect(pathnameOf(page)).toBe('/app/login');
			expect(await page.locator('#secret').count()).toBe(0);
		});
	}, 60_000);

	test('a guard that cancels a back navigation puts the URL back', async () => {
		await withPage('/app', async (page) => {
			await page.click('#long-link');
			await page.waitForSelector('#long');
			await page.evaluate(() => Reflect.set(window, '__blockBack', true));
			await page.goBack();
			// The cancelled traversal is undone with history.go(1).
			await page.waitForFunction(
				() => window.location.pathname === '/app/long',
				undefined,
				{ timeout: 10_000 }
			);
			await Bun.sleep(300);

			expect(pathnameOf(page)).toBe('/app/long');
			expect(await page.locator('#long').count()).toBe(1);
			expect(await page.locator('#home').count()).toBe(0);

			await page.evaluate(() => Reflect.set(window, '__blockBack', false));
			await page.goBack();
			await page.waitForSelector('#home', { timeout: 10_000 });
			expect(pathnameOf(page)).toBe('/app');
		});
	}, 60_000);
});

describe('svelte router lazy routes', () => {
	test('the lazy route chunk is requested only on prefetch or navigation', async () => {
		await withPage('/app', async (page, scripts) => {
			const initial = [...scripts];
			const initialHasPanel = await Promise.all(
				initial.map((url) => scriptContains(url, lazyPanelSource))
			);
			expect(initial.length).toBeGreaterThan(0);
			expect(initialHasPanel.some(Boolean)).toBe(false);

			// Hover prefetch (debounced) loads the chunk before any click.
			await page.hover('#lazy-link');
			await page.waitForFunction(
				(count) =>
					performance.getEntriesByType('resource').filter((entry) =>
						entry.name.endsWith('.js')
					).length > count,
				initial.length,
				{ timeout: 10_000 }
			);
			const afterHover = scripts.slice(initial.length);
			const hoverHasPanel = await Promise.all(
				afterHover.map((url) => scriptContains(url, lazyPanelSource))
			);
			expect(hoverHasPanel.some(Boolean)).toBe(true);

			await page.click('#lazy-link');
			await page.waitForSelector('#lazy-panel', { timeout: 10_000 });
			expect(pathnameOf(page)).toBe('/app/lazy');
		});
	}, 60_000);

	test('a lazy route without prefetch loads on navigation and shows pending', async () => {
		await withPage('/app', async (page, scripts) => {
			const before = scripts.length;
			await page.click('#slow-link');
			await page.waitForSelector('#slow-pending', { timeout: 10_000 });
			await page.waitForSelector('#slow-panel', { timeout: 10_000 });

			expect(scripts.length).toBeGreaterThan(before);
			expect(await page.locator('#slow-pending').count()).toBe(0);
		});
	}, 60_000);

	test('the server renders the lazy component and the page hydrates it without a flash', async () => {
		const html = await (await fetch(`${baseUrl()}/app/lazy`)).text();
		expect(html).toContain('id="lazy-panel"');
		expect(html).not.toContain('lazy-pending');
		expect(html).toContain('__ABS_SVELTE_LAZY_ROUTES__');

		const session = await openPage(`${baseUrl()}/app/login`);
		const warnings: string[] = [];
		session.page.on('console', (message) => {
			if (message.type() === 'warning' || message.type() === 'error') {
				warnings.push(message.text());
			}
		});
		try {
			// Watch the document from its first byte: remember the server's
			// panel node, and note if a pending state ever shows or the panel
			// ever disappears after it arrived.
			await session.page.addInitScript(() => {
				const seen: string[] = [];
				Reflect.set(window, '__pendingSeen', seen);
				new MutationObserver(() => {
					const panel = document.getElementById('lazy-panel');
					const first = Reflect.get(window, '__ssrPanel');
					if (panel && !first) Reflect.set(window, '__ssrPanel', panel);
					if (document.getElementById('lazy-pending')) seen.push('pending');
					if (first && !panel) seen.push('missing');
				}).observe(document, { childList: true, subtree: true });
			});
			await session.page.goto(`${baseUrl()}/app/lazy`);
			await session.page.waitForFunction(
				() => Reflect.get(window, '__hydrated') === true,
				undefined,
				{ timeout: 15_000 }
			);
			await session.page.click('#lazy-count');
			await session.page.waitForFunction(
				() =>
					document.getElementById('lazy-count')?.textContent === 'count 1',
				undefined,
				{ timeout: 5_000 }
			);

			// Hydration adopted the server's node instead of re-rendering it.
			expect(
				await session.page.evaluate(
					() =>
						Reflect.get(window, '__ssrPanel') ===
						document.getElementById('lazy-panel')
				)
			).toBe(true);
			expect(
				await session.page.evaluate(() => Reflect.get(window, '__pendingSeen'))
			).toEqual([]);
			expect(warnings.filter((text) => /hydrat/i.test(text))).toEqual([]);
		} finally {
			await session.close();
		}
	}, 60_000);

	test('a direct request for a lazy route is a known SPA route, not a 404', async () => {
		const response = await fetch(`${baseUrl()}/app/slow`);

		expect(response.status).toBe(200);
		expect(await response.text()).toContain('id="slow-panel"');
	});
});

describe('svelte router scroll restoration', () => {
	test('back/forward restores the scroll position and new navigations start at the top', async () => {
		await withPage('/app', async (page) => {
			expect(
				await page.evaluate(() => history.scrollRestoration)
			).toBe('manual');
			await page.click('#long-link');
			await page.waitForSelector('#long');
			await page.evaluate(() => window.scrollTo(0, 2000));
			await page.waitForFunction(() => window.scrollY === 2000);

			await page.click('#home-link');
			await page.waitForSelector('#home');
			await page.waitForFunction(() => window.scrollY === 0);
			await page.evaluate(() => window.scrollTo(0, 700));
			await page.waitForFunction(() => window.scrollY === 700);

			await page.goBack();
			await page.waitForSelector('#long');
			await page.waitForFunction(() => window.scrollY === 2000, undefined, {
				timeout: 10_000
			});

			await page.goForward();
			await page.waitForSelector('#home');
			await page.waitForFunction(() => window.scrollY === 700, undefined, {
				timeout: 10_000
			});
			expect(await scrollY(page)).toBe(700);
		});
	}, 60_000);

	test('a #hash link lands on its target', async () => {
		await withPage('/app', async (page) => {
			await page.click('#hash-link');
			await page.waitForSelector('#long');
			await page.waitForFunction(
				() => {
					const top = document
						.getElementById('section-5')
						?.getBoundingClientRect().top;

					return top !== undefined && Math.abs(top) < 2;
				},
				undefined,
				{ timeout: 10_000 }
			);
			expect(new URL(page.url()).hash).toBe('#section-5');
		});
	}, 60_000);

	test('goto(url, { noScroll: true }) keeps the scroll position', async () => {
		await withPage('/app', async (page) => {
			await page.evaluate(() => window.scrollTo(0, 1200));
			await page.waitForFunction(() => window.scrollY === 1200);
			await page.evaluate(async () => {
				const go = Reflect.get(window, '__goto');
				if (typeof go === 'function') {
					await go('/app/long', { noScroll: true });
				}
			});
			await page.waitForSelector('#long');

			expect(await scrollY(page)).toBe(1200);
		});
	}, 60_000);

	test('a reload restores the position saved in the history entry', async () => {
		await withPage('/app', async (page) => {
			await page.click('#long-link');
			await page.waitForSelector('#long');
			await page.evaluate(() => window.scrollTo(0, 1500));
			await page.waitForFunction(() => window.scrollY === 1500);
			await page.reload();
			await page.waitForFunction(
				() => Reflect.get(window, '__hydrated') === true
			);
			await page.waitForFunction(() => window.scrollY === 1500, undefined, {
				timeout: 10_000
			});
			expect(await scrollY(page)).toBe(1500);
		});
	}, 60_000);
});
