import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import type { Page } from 'playwright';
import type { ComponentType } from 'react';
import { build } from '../../../src/core/build';
import { setCurrentIslandRegistry } from '../../../src/core/currentIslandRegistry';
import { setCurrentIslandManifest } from '../../../src/core/islandPageContext';
import { loadIslandRegistry } from '../../../src/core/loadIslandRegistry';
import { handleReactPageRequest } from '../../../src/react/pageHandler';
import { handleSveltePageRequest } from '../../../src/svelte/pageHandler';
import { handleVuePageRequest } from '../../../src/vue/pageHandler';
import { openPage } from '../../helpers/browser';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';
import { unservedPath } from '../../helpers/unservedPath';

/* An island inside a page with `ssr: false`.
 *
 * On a server-rendered page the server writes the island's markup and
 * the island runtime hydrates it. Here there is no server markup at all:
 * the page mounts in the browser, the island's element appears then, and
 * the runtime has to notice an island it was never told about at load
 * and mount it from nothing.
 *
 * Asserted for each framework's page hosting the same Svelte island: the
 * island is there, it is live, the page around it is live too, and it
 * was mounted once. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const fixtureRoot = join(
	repoRoot,
	'.test-builds',
	`ssr-false-islands-${process.pid}`
);

const ISLAND = `<script lang="ts">
	import { onMount } from 'svelte';

	let { label }: { label: string } = $props();
	let count = $state(0);

	onMount(() => {
		const mounts = Reflect.get(window, '__islandMounts');
		Reflect.set(
			window,
			'__islandMounts',
			(typeof mounts === 'number' ? mounts : 0) + 1
		);
	});
</script>

<button id="island-button" onclick={() => (count += 1)}>{label} {count}</button>
`;

const ISLAND_REGISTRY = `import { defineIslandRegistry } from '@absolutejs/absolute/islands';
import Counter from './Counter.svelte';

export const islandRegistry = defineIslandRegistry({ svelte: { Counter } });
`;

const REACT_PAGE = `import { useState } from 'react';
import { Island } from '@absolutejs/absolute/react';

export const IslandHostReact = () => {
	const [count, setCount] = useState(0);
	// Throws on a server: there is no window there.
	const where = window.location.pathname;

	return (
		<html lang="en">
			<head>
				<title>React host</title>
			</head>
			<body>
				<main id="host-page" data-where={where}>
					<button id="page-button" onClick={() => setCount(count + 1)}>
						page {count}
					</button>
					<Island
						component="Counter"
						framework="svelte"
						hydrate="load"
						props={{ label: 'island' }}
					/>
				</main>
			</body>
		</html>
	);
};
`;

const SVELTE_PAGE = `<script lang="ts">
	import Island from '@absolutejs/absolute/svelte/Island.svelte';

	let count = $state(0);
	// Throws on a server: there is no window there.
	const where = window.location.pathname;
</script>

<main id="host-page" data-where={where}>
	<button id="page-button" onclick={() => (count += 1)}>page {count}</button>
	<Island component="Counter" framework="svelte" hydrate="load" props={{ label: 'island' }} />
</main>
`;

const VUE_PAGE = `<script setup lang="ts">
import { ref } from 'vue';
import { Island } from '@absolutejs/absolute/vue';

const count = ref(0);
// Throws on a server: there is no window there.
const where = window.location.pathname;
</script>

<template>
	<main id="host-page" :data-where="where">
		<button id="page-button" @click="count += 1">page {{ count }}</button>
		<Island component="Counter" framework="svelte" hydrate="load" :props="{ label: 'island' }" />
	</main>
</template>
`;

type ReactPage = ComponentType<Record<never, never>>;
type Served = { baseUrl: string; stop: () => void };

let app: Served | undefined;

const isReactPage = (value: unknown): value is ReactPage =>
	typeof value === 'function';

const contentType = (path: string) => {
	if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
	if (path.endsWith('.css')) return 'text/css; charset=utf-8';

	return 'application/octet-stream';
};

const createApp = (
	buildDir: string,
	manifest: Record<string, string>,
	ReactComponent: ReactPage
) => {
	const renderPage = (request: Request) => {
		const { pathname } = new URL(request.url);
		if (pathname === '/react')
			return handleReactPageRequest({
				index: manifest.IslandHostReactIndex ?? '',
				Page: ReactComponent,
				request,
				ssr: false
			});
		if (pathname === '/svelte')
			return handleSveltePageRequest({
				indexPath: manifest.IslandHostSvelteIndex ?? '',
				pagePath: manifest.IslandHostSvelte ?? '',
				request,
				ssr: false
			});
		if (pathname === '/vue')
			return handleVuePageRequest({
				indexPath: manifest.IslandHostVueIndex ?? '',
				pagePath: manifest.IslandHostVue ?? '',
				props: {},
				request,
				ssr: false
			});

		return unservedPath(pathname);
	};

	return async (request: Request) => {
		const { pathname } = new URL(request.url);
		setCurrentIslandManifest(manifest, buildDir);
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
	await write('islands/Counter.svelte', ISLAND);
	await write('islands/registry.ts', ISLAND_REGISTRY);
	await write('react/pages/IslandHostReact.tsx', REACT_PAGE);
	await write('svelte/pages/IslandHostSvelte.svelte', SVELTE_PAGE);
	await write('vue/pages/IslandHostVue.vue', VUE_PAGE);

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
	setCurrentIslandRegistry(
		await loadIslandRegistry(join(fixtureRoot, 'islands', 'registry.ts'))
	);
	/* The page module is NOT imported here to find the component, as the
	 * other fixtures do: it reads `window` at render, and more to the
	 * point a client-only page's module may not be importable on a server
	 * at all. The handler only needs something to name. */
	const ReactComponent: unknown = Object.defineProperty(() => null, 'name', {
		value: 'IslandHostReact'
	});
	if (!isReactPage(ReactComponent))
		throw new Error('could not name the React page');

	const server = Bun.serve({
		fetch: createApp(
			join(fixtureRoot, 'build'),
			result?.manifest ?? {},
			ReactComponent
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

const urlOf = (path: string) => {
	if (!app) throw new Error('fixture app is not running');

	return `${app.baseUrl}${path}`;
};

type PageLog = { entries: string[] };

const record = (log: PageLog) => (page: Page) => {
	page.on('console', (message) => {
		if (message.type() === 'error')
			log.entries.push(`console.error: ${message.text()}`);
	});
	page.on('pageerror', (error) => {
		log.entries.push(`pageerror: ${error.message}`);
	});
	page.on('response', (response) => {
		if (response.status() >= 400)
			log.entries.push(`http ${response.status()}: ${response.url()}`);
	});
};

const textOf = (page: Page, selector: string) =>
	page.locator(selector).textContent();

const clickUntilText = async (page: Page, selector: string, text: string) => {
	await page.click(selector);
	await page.waitForFunction(
		([target, expected]) =>
			document.querySelector(target)?.textContent?.trim() === expected,
		[selector, text] as const,
		{ timeout: 10_000 }
	);
};

describe.each([['react'], ['svelte'], ['vue']] as const)(
	'a Svelte island inside a %s page with ssr: false',
	(framework) => {
		test('is not in the server response, and neither is its host', async () => {
			const html = await (await fetch(urlOf(`/${framework}`))).text();

			expect(html).not.toContain('host-page');
			expect(html).not.toContain('island-button');
		});

		test('mounts once the page has rendered, and both are live', async () => {
			const log: PageLog = { entries: [] };
			const session = await openPage(urlOf(`/${framework}`), {
				onPage: record(log),
				waitUntil: 'load'
			});
			try {
				const { page } = session;
				await page.waitForSelector('#island-button', {
					timeout: 30_000
				});
				await page.waitForFunction(
					() => Reflect.get(window, '__islandMounts') === 1,
					undefined,
					{ timeout: 30_000 }
				);

				// The island got its props and responds.
				expect(await textOf(page, '#island-button')).toBe('island 0');
				await clickUntilText(page, '#island-button', 'island 1');
				// The page around it is the browser's render, and is live.
				expect(
					await page.locator('#host-page').getAttribute('data-where')
				).toBe(`/${framework}`);
				await clickUntilText(page, '#page-button', 'page 1');
				// The page re-rendering did not replace or re-mount it.
				expect(await textOf(page, '#island-button')).toBe('island 1');
				expect(
					await page.evaluate(() =>
						Reflect.get(window, '__islandMounts')
					)
				).toBe(1);
				expect(await page.locator('#island-button').count()).toBe(1);
				expect(log.entries).toEqual([]);
			} finally {
				await session.close();
			}
		}, 120_000);
	}
);
