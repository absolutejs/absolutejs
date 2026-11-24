import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import type { Page } from 'playwright';
import { build } from '../../../src/core/build';
import { handleVuePageRequest } from '../../../src/vue/pageHandler';
import { openPage, type BrowserSession } from '../../helpers/browser';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

/* A Vue page that exports `routes` is server-rendered and hydrated.
 *
 * Parity item 3.8, the largest single gap against Nuxt in that plan: such
 * a page used to ship an empty `#root`. No content for a crawler, no
 * first paint before JavaScript, and nothing for a soft navigation to
 * swap in.
 *
 * It was not an oversight — the handler skipped the render because the
 * generated client index booted a routed page with `createApp`, a fresh
 * mount that discards server markup and makes every CSS entrance
 * animation fire twice. Both halves moved together: the index hydrates
 * now, so the markup is reused and the render is not wasted. The server
 * side needed nothing, because the auto-synthesised `setupApp` already
 * built the router with a memory history, pushed the request URL and
 * awaited `router.isReady()`.
 *
 * So the assertions are: the matched route's content is in the server
 * HTML, the page is interactive afterwards, and the element the server
 * sent is the SAME element after hydration — a re-mount would replace
 * it, which is what distinguishes hydration from the old behaviour. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const fixtureRoot = join(
	repoRoot,
	'.test-builds',
	`vue-routed-ssr-${process.pid}`
);

/* Two routes, so a URL has to be matched rather than a single root
 * component rendered regardless. `data-ssr` is written by the server
 * render and never by the client, so its survival proves the client
 * reused this element. */
const SHELL_PAGE = `<script lang="ts">
import { defineRoutes } from '@absolutejs/absolute/vue';
import Home from './routed/Home.vue';
import About from './routed/About.vue';

export const routes = defineRoutes([
	{ component: Home, path: '/shell' },
	{ component: About, path: '/shell/about' },
	// Named views: each one is split, as a single component is.
	{ components: { default: About, side: Home }, path: '/shell/split' }
]);
</script>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';

const route = useRoute();
const menuOpen = ref(false);

onMounted(() => {
	(window as unknown as Record<string, unknown>).__vueShellHydrated = true;
});
</script>

<template>
	<div id="shell" data-ssr="server">
		<RouterLink id="to-about" to="/shell/about">About</RouterLink>
		<RouterView />
		<RouterView name="side" />
	</div>
	<!-- A menu teleported to <body> that shows the current route, so every
	     navigation updates the teleport: the shape of a portal's account
	     menu, and the update that threw when its content was missing from
	     the server HTML. -->
	<Teleport to="body">
		<button id="teleported-menu" :data-route="route.path" @click="menuOpen = !menuOpen">
			menu {{ menuOpen ? 'open' : 'closed' }} at {{ route.path }}
		</button>
	</Teleport>
</template>
`;

const HOME_ROUTE = `<script setup lang="ts">
import { ref } from 'vue';

const count = ref(0);
</script>

<template>
	<div id="home-route">
		<p id="home-text">home route</p>
		<button id="home-increment" @click="count += 1">count {{ count }}</button>
	</div>
</template>
`;

const ABOUT_ROUTE = `<template>
	<p id="about-text">about route</p>
</template>
`;

type ServedApp = { baseUrl: string; stop: () => void };

let app: ServedApp | undefined;

const contentType = (path: string) => {
	if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
	if (path.endsWith('.css')) return 'text/css; charset=utf-8';

	return 'application/octet-stream';
};

const createApp = (buildDir: string, manifest: Record<string, string>) => {
	const renderPage = (request: Request) =>
		handleVuePageRequest({
			indexPath: manifest.ShellPageIndex ?? '',
			pagePath: manifest.ShellPage ?? '',
			props: {},
			request
		});

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

beforeAll(async () => {
	await ensureDistBuild();
	await mkdir(join(fixtureRoot, 'vue', 'pages', 'routed'), {
		recursive: true
	});
	await writeFile(
		join(fixtureRoot, 'vue', 'pages', 'ShellPage.vue'),
		SHELL_PAGE
	);
	await writeFile(
		join(fixtureRoot, 'vue', 'pages', 'routed', 'Home.vue'),
		HOME_ROUTE
	);
	await writeFile(
		join(fixtureRoot, 'vue', 'pages', 'routed', 'About.vue'),
		ABOUT_ROUTE
	);
	const rel = (path: string) =>
		relative(process.cwd(), join(fixtureRoot, path));
	const result = await build({
		buildDirectory: rel('build'),
		mode: 'production',
		options: { throwOnError: true },
		vueDirectory: rel('vue')
	});
	const server = Bun.serve({
		fetch: createApp(join(fixtureRoot, 'build'), result?.manifest ?? {}),
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

const withPage = async (
	path: string,
	run: (page: Page, errors: string[]) => Promise<void>
) => {
	const errors: string[] = [];
	const session: BrowserSession = await openPage(`${baseUrl()}${path}`, {
		consoleLog: (message: string) => {
			if (/hydrat|mismatch|error/i.test(message)) errors.push(message);
		},
		waitUntil: 'load'
	});
	try {
		const { page } = session;
		page.on('pageerror', (error) => errors.push(error.message));
		/* Runs before any page script, so the observer sees the parser
		 * build the server's markup and tags that element. A re-mount
		 * replaces it and the tag goes with it. */
		await page.addInitScript(() => {
			const observer = new MutationObserver(() => {
				const shell = document.getElementById('shell');
				if (!shell) return;
				Reflect.set(shell, '__fromServer', true);
				observer.disconnect();
			});
			observer.observe(document, { childList: true, subtree: true });
		});
		await page.reload({ waitUntil: 'load' });
		await run(page, errors);
	} finally {
		await session.close();
	}
};

describe('the server HTML of a routed Vue page', () => {
	test('contains the matched route, not an empty root', async () => {
		const html = await (await fetch(`${baseUrl()}/shell`)).text();

		// The whole of item 3.8 in one assertion.
		expect(html).toContain('home route');
		expect(html).toContain('id="shell"');
	});

	test('matches on the request URL rather than always rendering one route', async () => {
		const about = await (await fetch(`${baseUrl()}/shell/about`)).text();

		expect(about).toContain('about route');
		expect(about).not.toContain('home route');
	});
});

describe('a route with named views', () => {
	test('renders every view on the server and hydrates them', async () => {
		const html = await (await fetch(`${baseUrl()}/shell/split`)).text();
		expect(html).toContain('about route');
		expect(html).toContain('home route');

		await withPage('/shell/split', async (page, errors) => {
			await page.waitForFunction(
				() => Reflect.get(window, '__vueShellHydrated') === true,
				undefined,
				{ timeout: 20_000 }
			);
			await page.click('#home-increment');
			await page.waitForFunction(
				() =>
					document
						.getElementById('home-increment')
						?.textContent?.trim() === 'count 1',
				undefined,
				{ timeout: 10_000 }
			);
			expect(errors).toEqual([]);
		});
	}, 180_000);
});

describe('the client hydrates that HTML', () => {
	test('reuses the server element and is interactive', async () => {
		await withPage('/shell', async (page, errors) => {
			await page.waitForFunction(
				() => Reflect.get(window, '__vueShellHydrated') === true,
				undefined,
				{ timeout: 20_000 }
			);

			/* The element the PARSER created is still the one in the
			 * document, which is what separates hydration from a
			 * re-mount: `createApp().mount('#root')` clears the container
			 * and builds fresh nodes, so the tag would be gone.
			 *
			 * Tagged from an init script, not from `page.evaluate` after
			 * load — `waitUntil: 'load'` resolves once the module scripts
			 * have already run, so tagging there marks whatever element
			 * exists by then and the assertion passes either way. It did:
			 * restoring the fresh mount left this test green until the tag
			 * moved to an init-time observer. */
			expect(
				await page.evaluate(() =>
					Boolean(
						Reflect.get(
							document.getElementById('shell') ?? {},
							'__fromServer'
						)
					)
				)
			).toBe(true);
			// Still the server's markup, now live.
			expect(
				await page.evaluate(
					() =>
						document
							.getElementById('shell')
							?.getAttribute('data-ssr')
				)
			).toBe('server');

			await page.click('#home-increment');
			await page.waitForFunction(
				() =>
					document
						.getElementById('home-increment')
						?.textContent?.trim() === 'count 1',
				undefined,
				{ timeout: 10_000 }
			);

			// A hydration mismatch would be logged, and would mean the
			// server and client disagreed about the matched route.
			expect(errors).toEqual([]);
		});
	}, 180_000);

	test('client-side routing still works after hydration', async () => {
		await withPage('/shell', async (page) => {
			await page.waitForFunction(
				() => Reflect.get(window, '__vueShellHydrated') === true,
				undefined,
				{ timeout: 20_000 }
			);
			// vue-router owns in-shell navigation; hydrating rather than
			// re-mounting must not have broken it.
			await page.evaluate(() => {
				window.history.pushState({}, '', '/shell/about');
				window.dispatchEvent(new PopStateEvent('popstate'));
			});
			await page.waitForSelector('#about-text', { timeout: 10_000 });

			expect(await page.locator('#home-route').count()).toBe(0);
		});
	}, 180_000);
});

/* `<Teleport to="body">` on a routed page. Vue collects a teleport's
 * markup apart from the page and hydration looks for it as the target's
 * FIRST children; the server used to write only the framework's own
 * target, so body content was missing, hydration matched the teleport
 * against the page's own markup, and the next navigation threw inside
 * Vue ("Cannot read properties of null (reading 'emitsOptions')"),
 * leaving the previous route on screen. */
describe('a teleport to <body> on a routed page', () => {
	test('is in the server HTML, first in <body>', async () => {
		const html = await (await fetch(`${baseUrl()}/shell`)).text();
		const body = html.slice(html.indexOf('<body'));

		expect(body).toContain('id="teleported-menu"');
		expect(body.indexOf('id="teleported-menu"')).toBeLessThan(
			body.indexOf('<div id="root"')
		);
	});

	test('hydrates, stays interactive, and survives navigation', async () => {
		await withPage('/shell', async (page, errors) => {
			await page.waitForFunction(
				() => Reflect.get(window, '__vueShellHydrated') === true,
				undefined,
				{ timeout: 20_000 }
			);
			expect(await page.locator('#teleported-menu').count()).toBe(1);
			await page.click('#teleported-menu');
			await page.waitForFunction(
				() =>
					document
						.getElementById('teleported-menu')
						?.textContent?.includes('open') === true &&
					!document
						.getElementById('teleported-menu')
						?.textContent?.includes('closed'),
				undefined,
				{ timeout: 10_000 }
			);

			// The navigation that used to throw and leave the old route up.
			await page.click('#to-about');
			await page.waitForSelector('#about-text', { timeout: 10_000 });
			expect(await page.locator('#home-route').count()).toBe(0);
			expect(
				await page.getAttribute('#teleported-menu', 'data-route')
			).toBe('/shell/about');
			// The page's own markup was not replaced by mismatch recovery.
			expect(
				await page.evaluate(() =>
					Boolean(
						Reflect.get(
							document.getElementById('shell') ?? {},
							'__fromServer'
						)
					)
				)
			).toBe(true);
			expect(errors).toEqual([]);
		});
	}, 180_000);
});
