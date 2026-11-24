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
import { openPage, type BrowserSession } from '../../helpers/browser';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

/* Islands are unmounted with the markup that held them.
 *
 * Navigation phase 1 swapped `<body>` and left the old page's islands
 * mounted: their roots, effects, timers and listeners stayed alive attached
 * to detached nodes, and every navigation left another page's worth. The
 * first listed limitation of that phase, closed by
 * `src/client/islandDisposers.ts`.
 *
 * The island here is a SVELTE island on a REACT page, which is the case
 * that makes the registry's design matter: each framework's client pass
 * bundles its own copy of `@absolutejs/absolute/client`, so the Svelte
 * hydrator's disposer and the React page's navigation layer are in
 * different copies. Only a `Symbol.for` store is the same object in both.
 *
 * It asserts work stopping, not just a flag firing: the island runs an
 * interval, and after the navigation the tick count must stop moving.
 * A flag could be set by a teardown that left the timer running. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const fixtureRoot = join(
	repoRoot,
	'.test-builds',
	`island-teardown-${process.pid}`
);

/* The island's cleanup is observable from the page: `onDestroy` records
 * that it ran and stops the interval it started. `window.__ticks` keeps
 * counting for as long as the island is alive. */
const TICKER_ISLAND = `<script lang="ts">
	import { onDestroy, onMount } from 'svelte';

	let { label } = $props();
	let timer: ReturnType<typeof setInterval> | undefined;

	const target = () =>
		typeof window === 'undefined'
			? undefined
			: (window as unknown as Record<string, unknown>);

	onMount(() => {
		const scope = target();
		if (!scope) return;
		scope.__ticks = 0;
		timer = setInterval(() => {
			const ticks = scope.__ticks;
			scope.__ticks = (typeof ticks === 'number' ? ticks : 0) + 1;
		}, 20);
	});

	// Svelte runs onDestroy on the server too, when the SSR render closes,
	// so this cannot touch window unguarded.
	onDestroy(() => {
		if (timer !== undefined) clearInterval(timer);
		const scope = target();
		if (scope) scope.__islandDestroyed = label;
	});
</script>

<output id="ticker">{label}</output>
`;

const ISLAND_REGISTRY = `import { defineIslandRegistry } from '@absolutejs/absolute/islands';
import Ticker from './Ticker.svelte';

export const islandRegistry = defineIslandRegistry({ svelte: { Ticker } });
`;

const REACT_PAGE = `import { useEffect } from 'react';
import { enableNavigation } from '@absolutejs/absolute/client/navigation';
import { Island } from '@absolutejs/absolute/react';

export function IslandHost() {
	useEffect(() => {
		enableNavigation();
	}, []);

	return (
		<html lang="en">
			<head>
				<title>Island host</title>
			</head>
			<body>
				<div id="react-page" data-hydrated="true">
					<a href="/plain" id="to-plain">plain</a>
					<Island
						component="Ticker"
						framework="svelte"
						hydrate="load"
						props={{ label: 'ticker' }}
					/>
				</div>
			</body>
		</html>
	);
}
`;

const SVELTE_PAGE = `<script lang="ts">
	import { onMount } from 'svelte';
	import { enableNavigation } from '@absolutejs/absolute/client/navigation';

	onMount(() => {
		enableNavigation();
	});
</script>

<svelte:head><title>Plain page</title></svelte:head>

<div id="plain-page" data-hydrated="true">
	<a href="/react" id="to-react">react</a>
</div>
`;

type ServedApp = { baseUrl: string; stop: () => void };

let app: ServedApp | undefined;

const isReactPage = (value: unknown): value is Parameters<
	typeof handleReactPageRequest
>[0]['Page'] => typeof value === 'function';

const contentType = (path: string) => {
	if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
	if (path.endsWith('.css')) return 'text/css; charset=utf-8';

	return 'application/octet-stream';
};

const createApp = (
	buildDir: string,
	manifest: Record<string, string>,
	Page: Parameters<typeof handleReactPageRequest>[0]['Page']
) => {
	const renderPage = async (request: Request) => {
		const { pathname } = new URL(request.url);
		// The island markup the server writes needs the build manifest to
		// resolve each island's hashed client bundle and stylesheet
		// (core/islandPageContext.ts).
		setCurrentIslandManifest(manifest, buildDir);
		if (pathname === '/react') {
			return handleReactPageRequest({
				index: manifest.IslandHostIndex ?? '',
				Page,
				props: {},
				request
			});
		}
		if (pathname === '/plain') {
			return handleSveltePageRequest({
				indexPath: manifest.PlainPageIndex ?? '',
				pagePath: manifest.PlainPage ?? '',
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

beforeAll(async () => {
	await ensureDistBuild();
	const write = async (path: string, content: string) => {
		await mkdir(join(fixtureRoot, path, '..'), { recursive: true });
		await writeFile(join(fixtureRoot, path), content);
	};
	await write('islands/Ticker.svelte', TICKER_ISLAND);
	await write('islands/registry.ts', ISLAND_REGISTRY);
	await write('react/pages/IslandHost.tsx', REACT_PAGE);
	await write('svelte/pages/PlainPage.svelte', SVELTE_PAGE);

	const rel = (path: string) =>
		relative(process.cwd(), join(fixtureRoot, path));
	const result = await build({
		buildDirectory: rel('build'),
		islands: { registry: rel('islands/registry.ts') },
		mode: 'production',
		options: { throwOnError: true },
		reactDirectory: rel('react'),
		svelteDirectory: rel('svelte')
	});
	const manifest = result?.manifest ?? {};
	const pageModule: unknown = await import(
		join(fixtureRoot, 'react', 'pages', 'IslandHost.tsx')
	);
	const Page: unknown =
		typeof pageModule === 'object' && pageModule !== null
			? Reflect.get(pageModule, 'IslandHost')
			: undefined;
	if (!isReactPage(Page)) throw new Error('IslandHost page did not load');
	// What `prepare()` does at boot: the <Island> server component resolves
	// its component through the active registry (core/prepare.ts).
	setCurrentIslandRegistry(
		await loadIslandRegistry(join(fixtureRoot, 'islands', 'registry.ts'))
	);
	const server = Bun.serve({
		fetch: createApp(join(fixtureRoot, 'build'), manifest, Page),
		port: 0
	});
	app = {
		baseUrl: `http://localhost:${server.port}`,
		stop: () => server.stop(true)
	};
}, 240_000);

afterAll(async () => {
	app?.stop();
	setCurrentIslandRegistry(undefined);
	await rm(fixtureRoot, { force: true, recursive: true });
});

const baseUrl = () => {
	if (!app) throw new Error('fixture app is not running');

	return app.baseUrl;
};

const ticks = (page: Page) =>
	page.evaluate(() => {
		const value = Reflect.get(window, '__ticks');

		return typeof value === 'number' ? value : -1;
	});

/** How many island disposers the shared registry still holds. */
const registered = (page: Page) =>
	page.evaluate(() => {
		const store = Reflect.get(
			globalThis,
			Symbol.for('absolute.islandDisposers')
		);

		return store instanceof Set ? store.size : -1;
	});

const withPage = async (path: string, run: (page: Page) => Promise<void>) => {
	const session: BrowserSession = await openPage(`${baseUrl()}${path}`, {
		waitUntil: 'load'
	});
	try {
		await run(session.page);
	} finally {
		await session.close();
	}
};

describe('a soft navigation unmounts the islands it swaps away', () => {
	test('the island stops working and leaves the registry', async () => {
		await withPage('/react', async (page) => {
			// Hydrated, and its interval running.
			await page.waitForSelector(
				'[data-island="true"][data-hydrated="true"]',
				{ timeout: 15_000 }
			);
			await page.waitForFunction(
				() => {
					const value = Reflect.get(window, '__ticks');

					return typeof value === 'number' && value > 0;
				},
				undefined,
				{ timeout: 10_000 }
			);

			expect(await registered(page)).toBe(1);

			await page.click('#to-plain');
			await page.waitForSelector('#plain-page[data-hydrated="true"]', {
				timeout: 15_000
			});

			// Svelte's own teardown ran, so the component's onDestroy fired
			// rather than the subtree merely being detached.
			expect(await page.evaluate(() => Reflect.get(window, '__islandDestroyed'))).toBe(
				'ticker'
			);
			expect(await registered(page)).toBe(0);

			/* And the work stopped. The interval is the part a flag cannot
			 * prove: before this change the island's timer kept firing
			 * against a detached tree for the life of the tab. */
			const afterNavigation = await ticks(page);
			await page.waitForTimeout(200);

			expect(await ticks(page)).toBe(afterNavigation);
		});
	}, 120_000);

	test('the page it swaps to can hydrate its own islands', async () => {
		// Teardown must not leave the runtime unable to hydrate again:
		// going back re-mounts the island and the interval runs anew.
		await withPage('/react', async (page) => {
			await page.waitForSelector(
				'[data-island="true"][data-hydrated="true"]',
				{ timeout: 15_000 }
			);
			await page.click('#to-plain');
			await page.waitForSelector('#plain-page[data-hydrated="true"]', {
				timeout: 15_000
			});
			await page.click('#to-react');
			await page.waitForSelector(
				'[data-island="true"][data-hydrated="true"]',
				{ timeout: 15_000 }
			);

			expect(await registered(page)).toBe(1);
			await page.waitForFunction(
				() => {
					const value = Reflect.get(window, '__ticks');

					return typeof value === 'number' && value > 0;
				},
				undefined,
				{ timeout: 10_000 }
			);
		});
	}, 120_000);
});
