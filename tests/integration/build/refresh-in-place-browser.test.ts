import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import type { Page } from 'playwright';
import type { Component as SvelteComponent } from 'svelte';
import { build } from '../../../src/core/build';
import { setCurrentIslandManifest } from '../../../src/core/islandPageContext';
import { handleSveltePageRequest } from '../../../src/svelte/pageHandler';
import { handleVuePageRequest } from '../../../src/vue/pageHandler';
import { openPage, type BrowserSession } from '../../helpers/browser';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';
import { unservedPath } from '../../helpers/unservedPath';

/* `invalidate()` on a Svelte page and on a Vue page: the mounted page is
 * given new props, and is not taken down.
 *
 * Each page lists what the server holds, keeps a counter of its own and
 * has a text field. A button changes the server's list with a plain
 * `fetch` and calls `invalidate()`. Afterwards the list must be the new
 * one — and the counter, the typed text and the number of times the
 * page has been mounted must be exactly what they were.
 *
 * The React page has its own file (invalidate-browser.test.ts), which
 * also covers the cases where a refresh must NOT be done in place; those
 * are decided before any framework is involved, so they are not repeated
 * here. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const fixtureRoot = join(
	repoRoot,
	'.test-builds',
	`refresh-in-place-${process.pid}`
);
const INVALIDATE = resolve(repoRoot, 'src/client/invalidate').replace(
	/\\/g,
	'/'
);

const SVELTE_PAGE = `<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidate } from '${INVALIDATE}';

	let { items, heading = 'Items' }: { items: string[]; heading?: string } = $props();
	let clicks = $state(0);
	// Derived from a prop: has to follow it when the prop changes.
	let total = $derived(items.length);

	onMount(() => {
		Reflect.set(window, '__mounts', Number(Reflect.get(window, '__mounts') ?? 0) + 1);
		Reflect.set(window, '__pageHydrated', true);
	});

	const add = async () => {
		await fetch('/api/add', { method: 'POST' });
		Reflect.set(window, '__outcome', await invalidate());
	};
</script>

<svelte:head><title>Svelte items</title></svelte:head>

<main id="page">
	<h1 id="heading">{heading}</h1>
	<input id="note" type="text" />
	<button id="add" type="button" onclick={add}>add</button>
	<button id="clicks" type="button" onclick={() => (clicks += 1)}>{clicks}</button>
	<p id="total">{total}</p>
	<ul id="items">
		{#each items as item (item)}
			<li>{item}</li>
		{/each}
	</ul>
</main>
`;

const VUE_PAGE = `<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { invalidate } from '${INVALIDATE}';

const props = defineProps<{ items: string[]; heading?: string }>();
const clicks = ref(0);
// Derived from a prop: has to follow it when the prop changes.
const total = computed(() => props.items.length);

onMounted(() => {
	Reflect.set(window, '__mounts', Number(Reflect.get(window, '__mounts') ?? 0) + 1);
	Reflect.set(window, '__pageHydrated', true);
});

const add = async () => {
	await fetch('/api/add', { method: 'POST' });
	Reflect.set(window, '__outcome', await invalidate());
};
</script>

<template>
	<main id="page">
		<h1 id="heading">{{ props.heading ?? 'Items' }}</h1>
		<input id="note" type="text" />
		<button id="add" type="button" @click="add">add</button>
		<button id="clicks" type="button" @click="clicks += 1">{{ clicks }}</button>
		<p id="total">{{ total }}</p>
		<ul id="items">
			<li v-for="item in props.items" :key="item">{{ item }}</li>
		</ul>
	</main>
</template>
`;

type ServedApp = {
	baseUrl: string;
	state: ServerState;
	stop: () => void;
};

/* What the server holds. `heading` is a prop the page is given only
 * sometimes, to show that a prop the new data no longer has is cleared
 * rather than left at its old value. */
type ServerState = { heading: string | undefined; items: string[] };

let app: ServedApp | undefined;

const contentType = (path: string) => {
	if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
	if (path.endsWith('.css')) return 'text/css; charset=utf-8';

	return 'application/octet-stream';
};

const createApp = (
	buildDir: string,
	manifest: Record<string, string>,
	state: ServerState
) => {
	const propsNow = () => ({
		items: [...state.items],
		...(state.heading === undefined ? {} : { heading: state.heading })
	});
	const renderPage = (request: Request) => {
		const { pathname } = new URL(request.url);
		// One manifest per process; set here so the page is not handed
		// another fixture's (see ssr-false-browser.test.ts).
		setCurrentIslandManifest(manifest, buildDir);
		if (pathname === '/svelte')
			return handleSveltePageRequest<
				SvelteComponent<{ heading?: string; items: string[] }>
			>({
				indexPath: manifest.ItemsSvelteIndex ?? '',
				pagePath: manifest.ItemsSvelte ?? '',
				props: propsNow(),
				request
			});
		if (pathname === '/vue')
			return handleVuePageRequest({
				headTag: '<head><title>Vue items</title></head>',
				indexPath: manifest.ItemsVueIndex ?? '',
				pagePath: manifest.ItemsVue ?? '',
				props: propsNow(),
				request
			});

		return unservedPath(pathname);
	};

	return async (request: Request) => {
		const { pathname } = new URL(request.url);
		if (pathname === '/api/add' && request.method === 'POST') {
			state.items.push(`item ${state.items.length + 1}`);

			return Response.json({ count: state.items.length });
		}
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
	const write = async (path: string, content: string) => {
		await mkdir(join(fixtureRoot, path, '..'), { recursive: true });
		await writeFile(join(fixtureRoot, path), content);
	};
	await write('svelte/pages/ItemsSvelte.svelte', SVELTE_PAGE);
	await write('vue/pages/ItemsVue.vue', VUE_PAGE);

	const rel = (path: string) =>
		relative(process.cwd(), join(fixtureRoot, path));
	const result = await build({
		buildDirectory: rel('build'),
		mode: 'production',
		options: { throwOnError: true },
		svelteDirectory: rel('svelte'),
		vueDirectory: rel('vue')
	});
	const state: ServerState = { heading: undefined, items: [] };
	const server = Bun.serve({
		fetch: createApp(
			join(fixtureRoot, 'build'),
			result?.manifest ?? {},
			state
		),
		port: 0
	});
	app = {
		baseUrl: `http://localhost:${server.port}`,
		state,
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

type PageLog = { entries: string[] };

/* Opens the page with the server's list reset to one item, waits for it
 * to hydrate, and marks the window: a mark still there afterwards means
 * the document was never reloaded. */
const openItems = async (path: string, log: PageLog, heading?: string) => {
	const { baseUrl, state } = served();
	state.items.splice(0, state.items.length, 'item 1');
	state.heading = heading;
	const record = (page: Page) => {
		page.on('pageerror', (error) => {
			log.entries.push(`pageerror: ${error.message}`);
		});
		page.on('console', (message) => {
			if (message.type() === 'error')
				log.entries.push(`console.error: ${message.text()}`);
		});
	};
	const session: BrowserSession = await openPage(`${baseUrl}${path}`, {
		onPage: record,
		waitUntil: 'load'
	});
	// With what the page logged, so a page that never hydrated says why.
	await session.page
		.waitForFunction(
			() => Reflect.get(window, '__pageHydrated') === true,
			undefined,
			{ timeout: 30_000 }
		)
		.catch((error: unknown) => {
			throw new Error(
				`${path} did not hydrate: ${String(error)}\n${log.entries.join('\n')}`
			);
		});
	await session.page.evaluate(() => {
		Reflect.set(window, '__sameDocument', true);
	});

	return session;
};

const itemTexts = (page: Page) => page.locator('#items li').allTextContents();

const waitForItems = (page: Page, count: number) =>
	page.waitForFunction(
		(expected) =>
			document.querySelectorAll('#items li').length === expected,
		count,
		{ timeout: 30_000 }
	);

const read = (page: Page, name: string) =>
	page.evaluate((key) => Reflect.get(window, key), name);

/* What every case must show, or it has shown nothing: the page was
 * refreshed IN PLACE. A page that quietly reloaded also ends up with the
 * new list and one mount — and with none of its state, and no record of
 * how the refresh ended. The first version of these tests asserted only
 * the list and the mount count, and passed while every Svelte page was
 * being reloaded. */
const expectUpdatedInPlace = async (page: Page) => {
	await page.waitForFunction(
		() => Reflect.get(window, '__outcome') !== undefined,
		undefined,
		{ timeout: 30_000 }
	);
	expect(await read(page, '__outcome')).toBe('updated');
	expect(await read(page, '__sameDocument')).toBe(true);
	expect(await read(page, '__mounts')).toBe(1);
};

describe.each([
	['svelte', '/svelte'],
	['vue', '/vue']
] as const)('invalidate() on a %s page', (_framework, path) => {
	test('gives the page the new data without unmounting it', async () => {
		const log: PageLog = { entries: [] };
		const session = await openItems(path, log);
		try {
			const { page } = session;
			expect(await itemTexts(page)).toEqual(['item 1']);
			await page.click('#clicks');
			await page.click('#clicks');
			await page.fill('#note', 'half-typed');

			await page.click('#add');
			await waitForItems(page, 2);

			expect(await itemTexts(page)).toEqual(['item 1', 'item 2']);
			await expectUpdatedInPlace(page);
			// Everything the page was holding is still there.
			expect(await page.locator('#clicks').textContent()).toBe('2');
			expect(await page.inputValue('#note')).toBe('half-typed');
			expect(log.entries).toEqual([]);
		} finally {
			await session.close();
		}
	}, 120_000);

	/* A value the page computes from a prop is the easy thing to leave
	 * behind: the list updates and the count beside it does not. */
	test('what the page derives from its props follows them', async () => {
		const log: PageLog = { entries: [] };
		const session = await openItems(path, log);
		try {
			const { page } = session;
			expect(await page.locator('#total').textContent()).toBe('1');

			await page.click('#add');
			await waitForItems(page, 2);
			await page.click('#add');
			await waitForItems(page, 3);

			expect(await page.locator('#total').textContent()).toBe('3');
			await expectUpdatedInPlace(page);
			expect(log.entries).toEqual([]);
		} finally {
			await session.close();
		}
	}, 120_000);

	/* The page was rendered with a heading; the next data has none. The
	 * old one must not linger, or the page shows a mix of two answers. */
	test('a prop the new data no longer has is cleared', async () => {
		const log: PageLog = { entries: [] };
		const session = await openItems(path, log, 'Special offers');
		try {
			const { page } = session;
			expect(await page.locator('#heading').textContent()).toBe(
				'Special offers'
			);
			served().state.heading = undefined;

			await page.click('#add');
			await waitForItems(page, 2);

			expect(await page.locator('#heading').textContent()).toBe('Items');
			await expectUpdatedInPlace(page);
			expect(log.entries).toEqual([]);
		} finally {
			await session.close();
		}
	}, 120_000);

	test('the page still works afterwards: its own state keeps changing', async () => {
		const log: PageLog = { entries: [] };
		const session = await openItems(path, log);
		try {
			const { page } = session;
			await page.click('#add');
			await waitForItems(page, 2);
			await expectUpdatedInPlace(page);

			await page.click('#clicks');

			expect(await page.locator('#clicks').textContent()).toBe('1');
			expect(log.entries).toEqual([]);
		} finally {
			await session.close();
		}
	}, 120_000);
});
