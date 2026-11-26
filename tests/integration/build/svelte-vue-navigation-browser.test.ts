import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { unservedPath } from '../../helpers/unservedPath';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import type { Page } from 'playwright';
import { build } from '../../../src/core/build';
import { handleSveltePageRequest } from '../../../src/svelte/pageHandler';
import { handleVuePageRequest } from '../../../src/vue/pageHandler';
import { openPage, type BrowserSession } from '../../helpers/browser';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

/* Svelte ↔ Vue: the first verified matrix pair that does not involve
 * React, and the reason it is worth its own test rather than being
 * assumed from the React rows.
 *
 * Each framework's client pass bundles its own copy of
 * `@absolutejs/absolute/client`, so the copy that INSTALLS the layer and
 * the copy that hydrated the page being torn down can be different
 * modules. That is where this codebase's real bugs have been: the
 * prefetch cache was one store per copy, so a hover warmed a cache the
 * navigating layer never read (beta.236), and the island disposer
 * registry had to move to a `Symbol.for` key for a React page's layer to
 * see a Svelte island's disposer (beta.234). Every row verified so far
 * goes through React, so the layer has only ever been installed by a
 * React or Svelte copy with React on one side.
 *
 * Here the layer is installed by whichever page is entered first and has
 * to tear down the other framework entirely — no React involved. Both
 * directions are driven, from both entry points, because which copy owns
 * the layer depends on which page the session started at. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const fixtureRoot = join(
	repoRoot,
	'.test-builds',
	`svelte-vue-nav-${process.pid}`
);

const SVELTE_PAGE = `<script lang="ts">
	import { onMount } from 'svelte';
	import { enableNavigation } from '@absolutejs/absolute/client/navigation';

	let count = $state(0);

	onMount(() => {
		enableNavigation();
		Reflect.set(window, '__svelteHydrated', true);
	});
</script>

<svelte:head><title>Svelte page</title></svelte:head>

<div id="svelte-page" data-hydrated="true">
	<button id="svelte-increment" onclick={() => (count += 1)}>count {count}</button>
	<a href="/vue" id="to-vue">vue</a>
</div>
`;

const VUE_PAGE = `<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { enableNavigation } from '@absolutejs/absolute/client/navigation';

const count = ref(0);

onMounted(() => {
	enableNavigation();
	(window as unknown as Record<string, unknown>).__vueHydrated = true;
});
</script>

<template>
	<div id="vue-page" data-hydrated="true">
		<button id="vue-increment" @click="count += 1">count {{ count }}</button>
		<a href="/svelte" id="to-svelte">svelte</a>
	</div>
</template>
`;

type ServedApp = { baseUrl: string; stop: () => void };

let app: ServedApp | undefined;

const contentType = (path: string) => {
	if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
	if (path.endsWith('.css')) return 'text/css; charset=utf-8';

	return 'application/octet-stream';
};

const createApp =
	(buildDir: string, manifest: Record<string, string>) =>
	async (request: Request) => {
		const { pathname } = new URL(request.url);
		if (pathname === '/svelte')
			return handleSveltePageRequest({
				indexPath: manifest.PairSvelteIndex ?? '',
				pagePath: manifest.PairSvelte ?? '',
				request
			});
		if (pathname === '/vue')
			return handleVuePageRequest({
				indexPath: manifest.PairVueIndex ?? '',
				pagePath: manifest.PairVue ?? '',
				props: {},
				request
			});
		if (extname(pathname) === '') return unservedPath(pathname);
		const filePath = join(buildDir, pathname);
		if (!existsSync(filePath)) return new Response(null, { status: 404 });

		return new Response(Bun.file(filePath), {
			headers: { 'Content-Type': contentType(filePath) }
		});
	};

beforeAll(async () => {
	await ensureDistBuild();
	await mkdir(join(fixtureRoot, 'svelte', 'pages'), { recursive: true });
	await mkdir(join(fixtureRoot, 'vue', 'pages'), { recursive: true });
	await writeFile(
		join(fixtureRoot, 'svelte', 'pages', 'PairSvelte.svelte'),
		SVELTE_PAGE
	);
	await writeFile(join(fixtureRoot, 'vue', 'pages', 'PairVue.vue'), VUE_PAGE);
	const rel = (path: string) =>
		relative(process.cwd(), join(fixtureRoot, path));
	const result = await build({
		buildDirectory: rel('build'),
		mode: 'production',
		options: { throwOnError: true },
		svelteDirectory: rel('svelte'),
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

type Observations = { documentLoads: string[]; errors: string[] };

const withPage = async (
	path: string,
	run: (page: Page, seen: Observations) => Promise<void>
) => {
	const seen: Observations = { documentLoads: [], errors: [] };
	const session: BrowserSession = await openPage(`${baseUrl()}${path}`, {
		waitUntil: 'load',
		consoleLog: (message: string) => {
			if (/hydrat|mismatch|error/i.test(message))
				seen.errors.push(message);
		}
	});
	try {
		const { page } = session;
		page.on('pageerror', (error) => seen.errors.push(error.message));
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

const hydrated = (page: Page, flag: string) =>
	page.waitForFunction((name) => Reflect.get(window, name) === true, flag, {
		timeout: 20_000
	});

/* Clear the flag, then click, then wait for the new page to set it.
 *
 * `window` survives a soft navigation — that is the point of one — so a
 * flag set by the first visit is still true when the second starts, and
 * waiting on it returns immediately. The first version of this test did
 * that and asserted the URL before the navigation had finished, which
 * showed up as "/vue" where "/svelte" was expected rather than as a
 * timeout. Clearing it first makes the wait mean "this visit's onMount
 * ran". */
const navigateTo = async (page: Page, link: string, flag: string) => {
	await page.evaluate((name) => Reflect.deleteProperty(window, name), flag);
	await page.click(link);
	await hydrated(page, flag);
};

/** The disposer registry, which both copies of the runtime share through
 *  a `Symbol.for` key. Reads -1 when no copy has created it. */
const registeredIslands = (page: Page) =>
	page.evaluate(() => {
		const store = Reflect.get(
			globalThis,
			Symbol.for('absolute.islandDisposers')
		);

		return store instanceof Set ? store.size : -1;
	});

describe('entering at the Svelte page', () => {
	test('swaps to Vue and back, with the layer owned by the Svelte copy', async () => {
		await withPage('/svelte', async (page, seen) => {
			await hydrated(page, '__svelteHydrated');

			await navigateTo(page, '#to-vue', '__vueHydrated');

			expect(new URL(page.url()).pathname).toBe('/vue');
			expect(await sameDocument(page)).toBe(true);
			expect(await page.locator('#svelte-page').count()).toBe(0);
			// Interactive, so the Vue page was hydrated rather than just
			// pasted in by a layer that belongs to another framework.
			await page.click('#vue-increment');
			await page.waitForFunction(
				() =>
					document
						.getElementById('vue-increment')
						?.textContent?.trim() === 'count 1',
				undefined,
				{ timeout: 10_000 }
			);

			await navigateTo(page, '#to-svelte', '__svelteHydrated');

			expect(new URL(page.url()).pathname).toBe('/svelte');
			expect(await sameDocument(page)).toBe(true);
			await page.click('#svelte-increment');
			await page.waitForFunction(
				() =>
					document
						.getElementById('svelte-increment')
						?.textContent?.trim() === 'count 1',
				undefined,
				{ timeout: 10_000 }
			);

			expect(seen.documentLoads).toEqual([]);
			expect(seen.errors).toEqual([]);
			// Neither page has islands, so nothing should have been left
			// registered by either copy of the runtime.
			expect(await registeredIslands(page)).toBeLessThanOrEqual(0);
		});
	}, 240_000);
});

describe('entering at the Vue page', () => {
	test('swaps to Svelte and back, with the layer owned by the Vue copy', async () => {
		/* The same trip with the other framework's copy installing the
		 * layer. Which copy owns it depends on which page the session
		 * started at, and the teardown path differs per framework, so one
		 * direction passing says nothing about the other. */
		await withPage('/vue', async (page, seen) => {
			await hydrated(page, '__vueHydrated');

			await navigateTo(page, '#to-svelte', '__svelteHydrated');

			expect(new URL(page.url()).pathname).toBe('/svelte');
			expect(await sameDocument(page)).toBe(true);
			expect(await page.locator('#vue-page').count()).toBe(0);
			await page.click('#svelte-increment');
			await page.waitForFunction(
				() =>
					document
						.getElementById('svelte-increment')
						?.textContent?.trim() === 'count 1',
				undefined,
				{ timeout: 10_000 }
			);

			await navigateTo(page, '#to-vue', '__vueHydrated');

			expect(new URL(page.url()).pathname).toBe('/vue');
			expect(await sameDocument(page)).toBe(true);
			expect(seen.documentLoads).toEqual([]);
			expect(seen.errors).toEqual([]);
		});
	}, 240_000);

	test('back and forward traverse between the two', async () => {
		await withPage('/vue', async (page, seen) => {
			await hydrated(page, '__vueHydrated');
			await navigateTo(page, '#to-svelte', '__svelteHydrated');

			await page.goBack();
			await hydrated(page, '__vueHydrated');

			expect(new URL(page.url()).pathname).toBe('/vue');

			await page.goForward();
			await hydrated(page, '__svelteHydrated');

			expect(new URL(page.url()).pathname).toBe('/svelte');
			expect(await sameDocument(page)).toBe(true);
			expect(seen.documentLoads).toEqual([]);
		});
	}, 240_000);
});
