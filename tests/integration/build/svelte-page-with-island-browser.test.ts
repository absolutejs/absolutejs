import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import type { Page } from 'playwright';
import { build } from '../../../src/core/build';
import { setCurrentIslandRegistry } from '../../../src/core/currentIslandRegistry';
import { setCurrentIslandManifest } from '../../../src/core/islandPageContext';
import { loadIslandRegistry } from '../../../src/core/loadIslandRegistry';
import { handleSveltePageRequest } from '../../../src/svelte/pageHandler';
import { openPage, type BrowserSession } from '../../helpers/browser';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

/* A Svelte page that renders an `<Island>` has to hydrate like any other.
 *
 * It did not. `compileSvelte` built the page index with
 * `shouldHydrate = false`, so the page component was never mounted or
 * hydrated: its `onMount` never ran, its event handlers were never
 * attached and its state was never reactive. The island still worked — it
 * is hydrated by its own bootstrap, independently of the page — which is
 * how this shipped. The page looked right, because the server had already
 * rendered it, and only stopped responding to anything.
 *
 * The cause was a flag with the wrong name doing double duty.
 * `hasAwaitSlot` was set by FOUR lowering passes, two of which lower
 * island syntax rather than `{#await}` slots. A page with a streamed
 * `{#await}` genuinely cannot hydrate today (a known limitation), and an
 * island on the page put every such page into that same branch.
 *
 * So this test asserts the page is INTERACTIVE, not that it rendered:
 * rendering is the server's work and was never the thing that broke. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const fixtureRoot = join(
	repoRoot,
	'.test-builds',
	`svelte-island-page-${process.pid}`
);

const ISLAND = `<script lang="ts">
	import { onDestroy, onMount } from 'svelte';

	let count = $state(0);

	const scope = () => (typeof window === 'undefined' ? undefined : window);

	onMount(() => {
		const target = scope();
		if (!target) return;
		const mounts = Reflect.get(target, '__islandMounts');
		Reflect.set(
			target,
			'__islandMounts',
			(typeof mounts === 'number' ? mounts : 0) + 1
		);
	});

	// Svelte runs onDestroy on the server too, as the SSR render closes, so
	// this cannot touch window unguarded.
	onDestroy(() => {
		const target = scope();
		if (target) Reflect.set(target, '__islandDestroyed', true);
	});
</script>

<button id="island-button" onclick={() => (count += 1)}>island {count}</button>
`;

const ISLAND_REGISTRY = `import { defineIslandRegistry } from '@absolutejs/absolute/islands';
import Counter from './Counter.svelte';

export const islandRegistry = defineIslandRegistry({ svelte: { Counter } });
`;

const PAGE_WITH_ISLAND = `<script lang="ts">
	import { onMount } from 'svelte';
	import Island from '@absolutejs/absolute/svelte/Island.svelte';

	let pageCount = $state(0);

	onMount(() => {
		Reflect.set(window, '__pageMounted', true);
	});
</script>

<svelte:head><title>Island page</title></svelte:head>

<div id="island-page">
	<button id="page-button" onclick={() => (pageCount += 1)}>page {pageCount}</button>
	<Island component="Counter" framework="svelte" hydrate="load" props={{}} />
</div>
`;

/* The control. Identical but for the island, so a failure above cannot be
 * "Svelte pages do not hydrate in this fixture". */
const PAGE_WITHOUT_ISLAND = `<script lang="ts">
	import { onMount } from 'svelte';

	let pageCount = $state(0);

	onMount(() => {
		Reflect.set(window, '__plainMounted', true);
	});
</script>

<svelte:head><title>Plain page</title></svelte:head>

<div id="plain-page">
	<button id="plain-button" onclick={() => (pageCount += 1)}>page {pageCount}</button>
</div>
`;

type ServedApp = { baseUrl: string; stop: () => void };

let app: ServedApp | undefined;

const contentType = (path: string) => {
	if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
	if (path.endsWith('.css')) return 'text/css; charset=utf-8';

	return 'application/octet-stream';
};

const createApp = (buildDir: string, manifest: Record<string, string>) => {
	return async (request: Request) => {
		const { pathname } = new URL(request.url);
		setCurrentIslandManifest(manifest, buildDir);
		if (pathname === '/island')
			return handleSveltePageRequest({
				indexPath: manifest.IslandPageIndex ?? '',
				pagePath: manifest.IslandPage ?? '',
				props: {},
				request
			});
		if (pathname === '/plain')
			return handleSveltePageRequest({
				indexPath: manifest.PlainPageIndex ?? '',
				pagePath: manifest.PlainPage ?? '',
				props: {},
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
	await mkdir(join(fixtureRoot, 'svelte', 'pages'), { recursive: true });
	await mkdir(join(fixtureRoot, 'islands'), { recursive: true });
	await writeFile(join(fixtureRoot, 'islands', 'Counter.svelte'), ISLAND);
	await writeFile(
		join(fixtureRoot, 'islands', 'registry.ts'),
		ISLAND_REGISTRY
	);
	await writeFile(
		join(fixtureRoot, 'svelte', 'pages', 'IslandPage.svelte'),
		PAGE_WITH_ISLAND
	);
	await writeFile(
		join(fixtureRoot, 'svelte', 'pages', 'PlainPage.svelte'),
		PAGE_WITHOUT_ISLAND
	);
	const rel = (path: string) =>
		relative(process.cwd(), join(fixtureRoot, path));
	const result = await build({
		buildDirectory: rel('build'),
		islands: { registry: rel('islands/registry.ts') },
		mode: 'production',
		options: { throwOnError: true },
		svelteDirectory: rel('svelte')
	});
	setCurrentIslandRegistry(
		await loadIslandRegistry(join(fixtureRoot, 'islands', 'registry.ts'))
	);
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
	setCurrentIslandRegistry(undefined);
	await rm(fixtureRoot, { force: true, recursive: true });
});

const baseUrl = () => {
	if (!app) throw new Error('fixture app is not running');

	return app.baseUrl;
};

const clickUntil = async (page: Page, button: string, text: string) => {
	await page.click(button);
	await page.waitForFunction(
		([selector, expected]) =>
			document.querySelector(selector)?.textContent?.trim() === expected,
		[button, text] as const,
		{ timeout: 10_000 }
	);
};

const open = async (path: string, run: (page: Page) => Promise<void>) => {
	const session: BrowserSession = await openPage(`${baseUrl()}${path}`, {
		waitUntil: 'load'
	});
	try {
		await run(session.page);
	} finally {
		await session.close();
	}
};

describe('a Svelte page that renders an island', () => {
	test('hydrates: its own button works, and so does the island’s', async () => {
		await open('/island', async (page) => {
			await page.waitForFunction(
				() => Reflect.get(window, '__pageMounted') === true,
				undefined,
				{ timeout: 20_000 }
			);

			// The page's own reactivity, which is what was missing.
			await clickUntil(page, '#page-button', 'page 1');
			/* And the island, which worked even when the page did not — so
			 * asserting only this would have passed throughout the defect.
			 * It is also the check for the second half of the fix: when the
			 * page mounted instead of hydrating, the server's copy of this
			 * button stayed in the document and every selector found that
			 * dead copy first. */
			await clickUntil(page, '#island-button', 'island 1');
			// Exactly one of each: a page that mounts over its own server
			// markup has two of everything.
			expect(await page.locator('#island-button').count()).toBe(1);
			expect(await page.locator('#page-button').count()).toBe(1);
		});
	}, 300_000);
});

describe('the island on that page', () => {
	test('is hydrated once, and leaves one disposer behind', async () => {
		/* The second defect this page had, measured rather than inferred.
		 * The island was hydrated by its own bootstrap, and then the page's
		 * client render RE-CREATED the island markup, so the runtime
		 * hydrated the new copy too: two instances, the first one left
		 * running on detached nodes with its effects, timers and
		 * subscriptions, held by the disposer registry until the next
		 * navigation pruned it. Every Svelte page with an island paid that
		 * on every load.
		 *
		 * Two disposers for one element is the shape of it, and why both
		 * numbers are asserted: a mount count of 1 alone would also pass if
		 * the second instance replaced the registry entry rather than
		 * adding to it, and a disposer count of 1 alone would pass if the
		 * island never hydrated at all. A React page reads 1 and 1, which
		 * is what this page should read too. */
		await open('/island', async (page) => {
			/* Wait for ANY mount, then settle, then assert the count. A wait
			 * for exactly 1 would be a race with the defect it is checking
			 * for: the count went 1 then 2 within a frame, so polling could
			 * miss the 1 and time out — which is a failure, but for the
			 * wrong reason and with a useless message. */
			await page.waitForFunction(
				() => {
					const mounts = Reflect.get(window, '__islandMounts');

					return typeof mounts === 'number' && mounts >= 1;
				},
				undefined,
				{ timeout: 20_000 }
			);
			// A second hydration arrives on a MutationObserver callback, so
			// "1 for now" is not the same as "1".
			await page.waitForTimeout(1500);

			expect(
				await page.evaluate(() => Reflect.get(window, '__islandMounts'))
			).toBe(1);
			expect(await page.locator('[data-island]').count()).toBe(1);
			expect(
				await page.evaluate(() => {
					const store = Reflect.get(
						globalThis,
						Symbol.for('absolute.islandDisposers')
					);

					return store instanceof Set ? store.size : -1;
				})
			).toBe(1);
			// Nothing was thrown away, so nothing was destroyed.
			expect(
				await page.evaluate(() =>
					Reflect.get(window, '__islandDestroyed')
				)
			).toBeUndefined();
		});
	}, 300_000);
});

describe('a Svelte page with no island', () => {
	test('hydrates, as it always did', async () => {
		await open('/plain', async (page) => {
			await page.waitForFunction(
				() => Reflect.get(window, '__plainMounted') === true,
				undefined,
				{ timeout: 20_000 }
			);
			await clickUntil(page, '#plain-button', 'page 1');
		});
	}, 300_000);
});
