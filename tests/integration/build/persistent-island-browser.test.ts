import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import type { Page } from 'playwright';
import { build } from '../../../src/core/build';
import { setCurrentIslandRegistry } from '../../../src/core/currentIslandRegistry';
import { setCurrentIslandManifest } from '../../../src/core/islandPageContext';
import { loadIslandRegistry } from '../../../src/core/loadIslandRegistry';
import { handleReactPageRequest } from '../../../src/react/pageHandler';
import { handleSveltePageRequest } from '../../../src/svelte/pageHandler';
import { handleVuePageRequest } from '../../../src/vue/pageHandler';
import { openPage, type BrowserSession } from '../../helpers/browser';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

/* `persist` on an island — navigation plan phase 5.
 *
 * An island both pages render with the same key keeps running across the
 * swap: the live element is moved into the incoming document instead of
 * being re-created, so the instance is never unmounted and never hydrated
 * again, and its DOM state comes with it. A navbar keeps its open menu
 * across React → Svelte, which is the thing no mainstream framework has to
 * do.
 *
 * The state asserted is deliberately the kind a store cannot carry.
 * `createIslandStore` state already survives a navigation — its snapshot
 * lives on `globalThis` — so a test that checked a store value would pass
 * with none of this built. A value typed into an input, an interval that
 * keeps counting and a mount count that stays at 1 are properties of the
 * instance and of the nodes themselves. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const fixtureRoot = join(
	repoRoot,
	'.test-builds',
	`persistent-island-${process.pid}`
);

const ISLAND = `<script lang="ts">
	import { onDestroy, onMount } from 'svelte';

	let ticks = $state(0);
	let timer: ReturnType<typeof setInterval> | undefined;

	const scope = () => (typeof window === 'undefined' ? undefined : window);

	onMount(() => {
		const target = scope();
		if (target) {
			const mounts = Reflect.get(target, '__islandMounts');
			Reflect.set(
				target,
				'__islandMounts',
				(typeof mounts === 'number' ? mounts : 0) + 1
			);
		}
		timer = setInterval(() => {
			ticks += 1;
		}, 50);
	});

	// Svelte runs onDestroy on the server too, as the SSR render closes, so
	// this cannot touch window unguarded.
	onDestroy(() => {
		if (timer !== undefined) clearInterval(timer);
		const target = scope();
		if (target) Reflect.set(target, '__islandDestroyed', true);
	});
</script>

<div id="shell-island">
	<input id="draft" placeholder="type here" />
	<output id="ticks">{ticks}</output>
</div>
`;

const ISLAND_REGISTRY = `import { defineIslandRegistry } from '@absolutejs/absolute/islands';
import Shell from './Shell.svelte';

export const islandRegistry = defineIslandRegistry({ svelte: { Shell } });
`;

const REACT_PAGE = `import { useEffect } from 'react';
import { enableNavigation } from '@absolutejs/absolute/client/navigation';
import { Island } from '@absolutejs/absolute/react';

export function PersistReact() {
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
					<Island
						component="Shell"
						framework="svelte"
						hydrate="load"
						persist="shell"
						props={{}}
					/>
					<a href="/svelte" id="to-svelte">svelte</a>
					<a href="/vue" id="to-vue">vue</a>
					<a href="/plain" id="to-plain">plain</a>
				</div>
			</body>
		</html>
	);
}
`;

/* The same island, same key, rendered by the other framework's page — so
 * either page works when entered cold, and a swap that failed to persist
 * would not look like nothing: the incoming page's own island would
 * hydrate, the mount count would read 2 and the typed value would be
 * gone. */
const SVELTE_PAGE = `<script lang="ts">
	import { onMount } from 'svelte';
	import { enableNavigation } from '@absolutejs/absolute/client/navigation';
	import Island from '@absolutejs/absolute/svelte/Island.svelte';

	onMount(() => {
		enableNavigation();
		Reflect.set(window, '__svelteHydrated', true);
	});
</script>

<svelte:head><title>Svelte page</title></svelte:head>

<div id="svelte-page" data-hydrated="true">
	<Island
		component="Shell"
		framework="svelte"
		hydrate="load"
		persist="shell"
		props={{}}
	/>
	<a href="/react" id="to-react">react</a>
</div>
`;

/* A VUE page rendering the same persisted island. Vue has its own island
 * preservation path (`src/client/preserveIslandMarkup.ts`, plus
 * `data-allow-mismatch`), which is not the one Svelte needed, so whether a
 * moved island survives a Vue page's hydration is a separate question from
 * whether it survives Svelte's. */
const VUE_PAGE = `<script setup lang="ts">
import { onMounted } from 'vue';
import { enableNavigation } from '@absolutejs/absolute/client/navigation';
import { Island } from '@absolutejs/absolute/vue';

onMounted(() => {
	enableNavigation();
	(window as unknown as Record<string, unknown>).__vueHydrated = true;
});
</script>

<template>
	<div id="vue-page" data-hydrated="true">
		<Island
			component="Shell"
			framework="svelte"
			hydrate="load"
			persist="shell"
			:props="{}"
		/>
		<a href="/react" id="to-react">react</a>
	</div>
</template>
`;

/* The control: a page that renders no island with that key. */
const PLAIN_PAGE = `<script lang="ts">
	import { onMount } from 'svelte';
	import { enableNavigation } from '@absolutejs/absolute/client/navigation';

	onMount(() => {
		enableNavigation();
		Reflect.set(window, '__plainHydrated', true);
	});
</script>

<svelte:head><title>Plain page</title></svelte:head>

<div id="plain-page" data-hydrated="true">
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

const createApp = (
	buildDir: string,
	manifest: Record<string, string>,
	Page: unknown
) => {
	return async (request: Request) => {
		const { pathname } = new URL(request.url);
		setCurrentIslandManifest(manifest, buildDir);
		if (pathname === '/react' && isReactPage(Page))
			return handleReactPageRequest({
				index: manifest.PersistReactIndex ?? '',
				Page,
				props: {},
				request
			});
		if (pathname === '/svelte')
			return handleSveltePageRequest({
				indexPath: manifest.PersistSvelteIndex ?? '',
				pagePath: manifest.PersistSvelte ?? '',
				props: {},
				request
			});
		if (pathname === '/vue')
			return handleVuePageRequest({
				indexPath: manifest.PersistVueIndex ?? '',
				pagePath: manifest.PersistVue ?? '',
				props: {},
				request
			});
		if (pathname === '/plain')
			return handleSveltePageRequest({
				indexPath: manifest.PersistPlainIndex ?? '',
				pagePath: manifest.PersistPlain ?? '',
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
	await mkdir(join(fixtureRoot, 'react', 'pages'), { recursive: true });
	await mkdir(join(fixtureRoot, 'svelte', 'pages'), { recursive: true });
	await mkdir(join(fixtureRoot, 'islands'), { recursive: true });
	await writeFile(join(fixtureRoot, 'islands', 'Shell.svelte'), ISLAND);
	await writeFile(
		join(fixtureRoot, 'islands', 'registry.ts'),
		ISLAND_REGISTRY
	);
	await writeFile(
		join(fixtureRoot, 'react', 'pages', 'PersistReact.tsx'),
		REACT_PAGE
	);
	await writeFile(
		join(fixtureRoot, 'svelte', 'pages', 'PersistSvelte.svelte'),
		SVELTE_PAGE
	);
	await writeFile(
		join(fixtureRoot, 'svelte', 'pages', 'PersistPlain.svelte'),
		PLAIN_PAGE
	);
	await mkdir(join(fixtureRoot, 'vue', 'pages'), { recursive: true });
	await writeFile(
		join(fixtureRoot, 'vue', 'pages', 'PersistVue.vue'),
		VUE_PAGE
	);
	const rel = (path: string) =>
		relative(process.cwd(), join(fixtureRoot, path));
	const result = await build({
		buildDirectory: rel('build'),
		islands: { registry: rel('islands/registry.ts') },
		mode: 'production',
		options: { throwOnError: true },
		reactDirectory: rel('react'),
		svelteDirectory: rel('svelte'),
		vueDirectory: rel('vue')
	});
	const pageModule: unknown = await import(
		join(fixtureRoot, 'react', 'pages', 'PersistReact.tsx')
	);
	const Page: unknown =
		typeof pageModule === 'object' && pageModule !== null
			? Reflect.get(pageModule, 'PersistReact')
			: undefined;
	setCurrentIslandRegistry(
		await loadIslandRegistry(join(fixtureRoot, 'islands', 'registry.ts'))
	);
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
	setCurrentIslandRegistry(undefined);
	await rm(fixtureRoot, { force: true, recursive: true });
});

const baseUrl = () => {
	if (!app) throw new Error('fixture app is not running');

	return app.baseUrl;
};

type Observations = { documentLoads: string[]; errors: string[] };

const openAt = async (
	path: string,
	run: (page: Page, seen: Observations) => Promise<void>
) => {
	const seen: Observations = { documentLoads: [], errors: [] };
	const session: BrowserSession = await openPage(`${baseUrl()}${path}`, {
		consoleLog: (message: string) => {
			if (/hydrat|mismatch|error/i.test(message))
				seen.errors.push(message);
		},
		waitUntil: 'load'
	});
	try {
		const { page } = session;
		page.on('pageerror', (error) => seen.errors.push(error.message));
		await page.waitForSelector('#shell-island', { timeout: 20_000 });
		await page.waitForFunction(
			() => {
				const mounts = Reflect.get(window, '__islandMounts');

				return typeof mounts === 'number' && mounts >= 1;
			},
			undefined,
			{ timeout: 20_000 }
		);
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

const mounts = (page: Page) =>
	page.evaluate(() => Reflect.get(window, '__islandMounts'));

const destroyed = (page: Page) =>
	page.evaluate(() => Reflect.get(window, '__islandDestroyed'));

const draftValue = (page: Page) =>
	page.evaluate(
		() =>
			(document.getElementById('draft') as HTMLInputElement | null)?.value
	);

const ticksNow = (page: Page) =>
	page.evaluate(() =>
		Number(document.getElementById('ticks')?.textContent?.trim() ?? '-1')
	);

const keepsRunning = async (page: Page, from: number) =>
	page.waitForFunction(
		(start) =>
			Number(
				document.getElementById('ticks')?.textContent?.trim() ?? '-1'
			) > start,
		from,
		{ timeout: 10_000 }
	);

describe('a persisted island', () => {
	test('survives React to Svelte with its instance and its DOM state', async () => {
		await openAt('/react', async (page, seen) => {
			await page.fill('#draft', 'half-written');
			const before = await ticksNow(page);

			await page.click('#to-svelte');
			await page.waitForFunction(
				() => Reflect.get(window, '__svelteHydrated') === true,
				undefined,
				{ timeout: 20_000 }
			);

			expect(new URL(page.url()).pathname).toBe('/svelte');
			expect(await sameDocument(page)).toBe(true);
			expect(await page.locator('#react-page').count()).toBe(0);
			/* The same instance, not a new one that looks alike: never
			 * mounted again, never destroyed, its interval still counting,
			 * and still holding what was typed into it on the page before.
			 * None of those survive a re-created island. */
			expect(await mounts(page)).toBe(1);
			expect(await destroyed(page)).toBeUndefined();
			expect(await draftValue(page)).toBe('half-written');
			await keepsRunning(page, before);
			expect(await page.locator('#shell-island').count()).toBe(1);
			expect(seen.documentLoads).toEqual([]);
			expect(seen.errors).toEqual([]);
		});
	}, 300_000);

	test('survives Svelte to React as well', async () => {
		/* The other direction, because the two are not symmetrical: which
		 * framework's hydration has to leave the moved island alone changes
		 * with the destination, and so does the copy of the runtime that
		 * owns the navigation layer. */
		await openAt('/svelte', async (page, seen) => {
			await page.fill('#draft', 'from svelte');
			const before = await ticksNow(page);

			await page.click('#to-react');
			await page.waitForSelector('#react-page[data-hydrated="true"]', {
				timeout: 20_000
			});

			expect(new URL(page.url()).pathname).toBe('/react');
			expect(await sameDocument(page)).toBe(true);
			expect(await mounts(page)).toBe(1);
			expect(await destroyed(page)).toBeUndefined();
			expect(await draftValue(page)).toBe('from svelte');
			await keepsRunning(page, before);
			expect(seen.documentLoads).toEqual([]);
			expect(seen.errors).toEqual([]);
		});
	}, 300_000);

	test('survives a round trip, back to where it started', async () => {
		await openAt('/react', async (page, seen) => {
			await page.fill('#draft', 'round trip');

			await page.click('#to-svelte');
			await page.waitForFunction(
				() => Reflect.get(window, '__svelteHydrated') === true,
				undefined,
				{ timeout: 20_000 }
			);
			await page.click('#to-react');
			await page.waitForSelector('#react-page[data-hydrated="true"]', {
				timeout: 20_000
			});

			expect(await mounts(page)).toBe(1);
			expect(await draftValue(page)).toBe('round trip');
			expect(seen.documentLoads).toEqual([]);
		});
	}, 300_000);
});

describe('a page that renders no island with that key', () => {
	test('tears the island down like any other', async () => {
		/* The guard against the obvious wrong implementation — persisting
		 * everything, always. A layout the next page never asked for has to
		 * go, or this feature is the island leak of beta.234 with a nicer
		 * name. */
		await openAt('/react', async (page, seen) => {
			await page.click('#to-plain');
			await page.waitForFunction(
				() => Reflect.get(window, '__plainHydrated') === true,
				undefined,
				{ timeout: 20_000 }
			);

			expect(await page.locator('#shell-island').count()).toBe(0);
			expect(await destroyed(page)).toBe(true);
			expect(
				await page.evaluate(() => {
					const store = Reflect.get(
						globalThis,
						Symbol.for('absolute.islandDisposers')
					);

					return store instanceof Set ? store.size : -1;
				})
			).toBeLessThanOrEqual(0);
			expect(seen.documentLoads).toEqual([]);
			expect(seen.errors).toEqual([]);
		});
	}, 300_000);
});

/* A Vue page as the DESTINATION of a persisted island does not work yet,
 * and deliberately has no test here: a test for broken behaviour would
 * lock it in. Vue removes DOM children its vnode does not have, so its
 * hydration deletes the moved island and its own `onMounted` fills the
 * host again — the instance is replaced at t+150ms, having been correctly
 * moved at t+50ms. The evidence and the two ways out are in
 * docs/CROSS_FRAMEWORK_NAVIGATION_PLAN.md (4i). What a Vue page DOES do
 * correctly is hydrate its own island exactly once, which is worth
 * holding on to. */
describe('a Vue page entered cold', () => {
	test('entered cold, hydrates its own island exactly once', async () => {
		/* The Svelte equivalent of this read 2 mounts and 2 disposers before
		 * beta.252 — an orphaned instance on every load. Whether Vue's
		 * preservation path has the same fault is its own measurement. */
		await openAt('/vue', async (page, seen) => {
			await page.waitForFunction(
				() => Reflect.get(window, '__vueHydrated') === true,
				undefined,
				{ timeout: 20_000 }
			);
			await page.waitForTimeout(1500);

			expect(await mounts(page)).toBe(1);
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
			expect(await destroyed(page)).toBeUndefined();
			expect(seen.errors).toEqual([]);
		});
	}, 300_000);
});
