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

/* `navigation: true` installs the cross-framework layer from every
 * hydration index — navigation plan phase 4.
 *
 * The point is what these fixture pages DO NOT contain: neither imports
 * `@absolutejs/absolute/client/navigation` and neither calls
 * `enableNavigation()`. Every other navigation test in this repo has to,
 * which is the papercut this removes — and forgetting the call on one
 * page silently turns every link out of it into a full document load,
 * which looks like nothing at all until someone watches the network.
 *
 * Two apps are built from the same sources, one with the flag and one
 * without, because the only honest proof that a default changed is that
 * the behaviour differs across it. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');

/* No `enableNavigation`, no client/navigation import — deliberately. */
const REACT_PAGE = `export function AutoNavReact() {
	return (
		<html lang="en">
			<head>
				<title>React page</title>
			</head>
			<body>
				<div id="react-page" data-hydrated="true">
					<a href="/svelte" id="to-svelte">svelte</a>
				</div>
			</body>
		</html>
	);
}
`;

const SVELTE_PAGE = `<script lang="ts">
	import { onMount } from 'svelte';

	let count = $state(0);

	onMount(() => {
		Reflect.set(window, '__svelteHydrated', true);
	});
</script>

<svelte:head><title>Svelte page</title></svelte:head>

<div id="svelte-page" data-hydrated="true">
	<button id="svelte-increment" onclick={() => (count += 1)}>count {count}</button>
	<a href="/react" id="to-react">react</a>
</div>
`;

type ServedApp = { baseUrl: string; stop: () => void };

const apps: Record<string, ServedApp | undefined> = {};
const fixtureRoots: string[] = [];

const isReactPage = (
	value: unknown
): value is Parameters<typeof handleReactPageRequest>[0]['Page'] =>
	typeof value === 'function';

const contentType = (path: string) => {
	if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
	if (path.endsWith('.css')) return 'text/css; charset=utf-8';

	return 'application/octet-stream';
};

const startApp = async (name: string, navigation: boolean) => {
	const fixtureRoot = join(
		repoRoot,
		'.test-builds',
		`config-navigation-${name}-${process.pid}`
	);
	fixtureRoots.push(fixtureRoot);
	await mkdir(join(fixtureRoot, 'react', 'pages'), { recursive: true });
	await mkdir(join(fixtureRoot, 'svelte', 'pages'), { recursive: true });
	await writeFile(
		join(fixtureRoot, 'react', 'pages', 'AutoNavReact.tsx'),
		REACT_PAGE
	);
	await writeFile(
		join(fixtureRoot, 'svelte', 'pages', 'AutoNavSvelte.svelte'),
		SVELTE_PAGE
	);
	const rel = (path: string) =>
		relative(process.cwd(), join(fixtureRoot, path));
	const result = await build({
		buildDirectory: rel('build'),
		mode: 'production',
		navigation,
		options: { throwOnError: true },
		reactDirectory: rel('react'),
		svelteDirectory: rel('svelte')
	});
	const manifest = result?.manifest ?? {};
	const pageModule: unknown = await import(
		join(fixtureRoot, 'react', 'pages', 'AutoNavReact.tsx')
	);
	const Page: unknown =
		typeof pageModule === 'object' && pageModule !== null
			? Reflect.get(pageModule, 'AutoNavReact')
			: undefined;
	if (!isReactPage(Page)) throw new Error('AutoNavReact did not load');
	const buildDir = join(fixtureRoot, 'build');
	const server = Bun.serve({
		port: 0,
		fetch: async (request: Request) => {
			const { pathname } = new URL(request.url);
			if (pathname === '/react')
				return handleReactPageRequest({
					index: manifest.AutoNavReactIndex ?? '',
					Page,
					props: {},
					request
				});
			if (pathname === '/svelte')
				return handleSveltePageRequest({
					indexPath: manifest.AutoNavSvelteIndex ?? '',
					pagePath: manifest.AutoNavSvelte ?? '',
					request
				});
			if (extname(pathname) === '')
				return new Response('not found', { status: 404 });
			const filePath = join(buildDir, pathname);
			if (!existsSync(filePath))
				return new Response(null, { status: 404 });

			return new Response(Bun.file(filePath), {
				headers: { 'Content-Type': contentType(filePath) }
			});
		}
	});

	return {
		baseUrl: `http://localhost:${server.port}`,
		stop: () => server.stop(true)
	};
};

beforeAll(async () => {
	await ensureDistBuild();
	apps.on = await startApp('on', true);
	apps.off = await startApp('off', false);
}, 600_000);

afterAll(async () => {
	apps.on?.stop();
	apps.off?.stop();
	for (const root of fixtureRoots) {
		await rm(root, { force: true, recursive: true });
	}
});

const baseUrl = (key: 'off' | 'on') => {
	const app = apps[key];
	if (!app) throw new Error(`fixture app ${key} is not running`);

	return app.baseUrl;
};

/** Navigates React → Svelte and reports whether a document was loaded,
 *  which is the whole difference between a swap and a page load. */
const navigateAndCount = async (
	key: 'off' | 'on',
	run?: (page: Page) => Promise<void>
) => {
	const documentLoads: string[] = [];
	const session: BrowserSession = await openPage(`${baseUrl(key)}/react`, {
		waitUntil: 'load'
	});
	try {
		const { page } = session;
		await page.waitForSelector('#react-page[data-hydrated="true"]', {
			timeout: 20_000
		});
		page.on('request', (request) => {
			if (request.resourceType() === 'document')
				documentLoads.push(request.url());
		});
		await page.evaluate(() => Reflect.set(window, '__sameDocument', true));
		await page.click('#to-svelte');
		await page.waitForFunction(
			() => Reflect.get(window, '__svelteHydrated') === true,
			undefined,
			{ timeout: 20_000 }
		);
		const sameDocument = await page.evaluate(
			() => Reflect.get(window, '__sameDocument') === true
		);
		await run?.(page);

		return { documentLoads, sameDocument };
	} finally {
		await session.close();
	}
};

describe('navigation: true', () => {
	test('pages soft-navigate without calling enableNavigation', async () => {
		const { documentLoads, sameDocument } = await navigateAndCount(
			'on',
			async (page) => {
				// Hydrated, not merely swapped in.
				await page.click('#svelte-increment');
				await page.waitForFunction(
					() =>
						document
							.getElementById('svelte-increment')
							?.textContent?.trim() === 'count 1',
					undefined,
					{ timeout: 10_000 }
				);
			}
		);

		expect(sameDocument).toBe(true);
		expect(documentLoads).toEqual([]);
	}, 240_000);
});

describe('without the flag', () => {
	test('the same pages do a full document load', async () => {
		/* The control, and the only thing that makes the test above mean
		 * anything: identical sources, so the difference is the flag. */
		const { documentLoads, sameDocument } = await navigateAndCount('off');

		expect(sameDocument).toBe(false);
		expect(documentLoads.length).toBeGreaterThan(0);
	}, 240_000);
});
