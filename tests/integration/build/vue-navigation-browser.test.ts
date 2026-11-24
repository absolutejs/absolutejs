import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import type { Page } from 'playwright';
import { build } from '../../../src/core/build';
import { handleReactPageRequest } from '../../../src/react/pageHandler';
import { handleVuePageRequest } from '../../../src/vue/pageHandler';
import { openPage, type BrowserSession } from '../../helpers/browser';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

/* Vue pages in the cross-framework navigation matrix — navigation plan
 * phase 3, whose exit criterion is the phase 1 suite for every framework
 * pair.
 *
 * Phase 3's scope says Vue's `<Link>` must "hand off unmatched URLs".
 * Reading it, `Link.ts` already does: with no vue-router on the page, or
 * an `href` its routes do not match, it returns without calling
 * `preventDefault`, so the click reaches the layer's bubble-phase window
 * listener. This asserts the whole round trip rather than that one
 * branch, because what matters is the page swapping in place and coming
 * back interactive. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const fixtureRoot = join(
	repoRoot,
	'.test-builds',
	`vue-navigation-${process.pid}`
);

const REACT_PAGE = `import { useEffect } from 'react';
import { enableNavigation } from '@absolutejs/absolute/client/navigation';

export function VueNavReact() {
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
					<a href="/vue" id="to-vue">vue</a>
				</div>
			</body>
		</html>
	);
}
`;

/* A Vue page with no `routes` export, so it is server-rendered and
 * hydrated. `<Link>` is the component under test for the hand-off; the
 * page has no router, which is the "unmatched" case in its simplest
 * form. */
const VUE_PAGE = `<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { enableNavigation } from '@absolutejs/absolute/client/navigation';
import { Link } from '@absolutejs/absolute/vue';

const count = ref(0);

onMounted(() => {
	enableNavigation();
	(window as unknown as Record<string, unknown>).__vueHydrated = true;
});
</script>

<template>
	<div id="vue-page" data-hydrated="true">
		<button id="vue-increment" @click="count += 1">count {{ count }}</button>
		<Link href="/react" id="to-react">react</Link>
	</div>
</template>
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
	Page: Parameters<typeof handleReactPageRequest>[0]['Page']
) => {
	const renderPage = async (request: Request) => {
		const { pathname } = new URL(request.url);
		if (pathname === '/react') {
			return handleReactPageRequest({
				index: manifest.VueNavReactIndex ?? '',
				Page,
				props: {},
				request
			});
		}
		if (pathname === '/vue') {
			return handleVuePageRequest({
				indexPath: manifest.VueNavVueIndex ?? '',
				pagePath: manifest.VueNavVue ?? '',
				props: {},
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
	await mkdir(join(fixtureRoot, 'react', 'pages'), { recursive: true });
	await mkdir(join(fixtureRoot, 'vue', 'pages'), { recursive: true });
	await writeFile(
		join(fixtureRoot, 'react', 'pages', 'VueNavReact.tsx'),
		REACT_PAGE
	);
	await writeFile(
		join(fixtureRoot, 'vue', 'pages', 'VueNavVue.vue'),
		VUE_PAGE
	);
	const rel = (path: string) =>
		relative(process.cwd(), join(fixtureRoot, path));
	const result = await build({
		buildDirectory: rel('build'),
		mode: 'production',
		options: { throwOnError: true },
		reactDirectory: rel('react'),
		vueDirectory: rel('vue')
	});
	const manifest = result?.manifest ?? {};
	const pageModule: unknown = await import(
		join(fixtureRoot, 'react', 'pages', 'VueNavReact.tsx')
	);
	const Page: unknown =
		typeof pageModule === 'object' && pageModule !== null
			? Reflect.get(pageModule, 'VueNavReact')
			: undefined;
	if (!isReactPage(Page)) throw new Error('VueNavReact page did not load');
	const server = Bun.serve({
		fetch: createApp(join(fixtureRoot, 'build'), manifest, Page),
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
		waitUntil: 'load'
	});
	try {
		const { page } = session;
		page.on('pageerror', (error) => seen.errors.push(error.message));
		page.on('console', (message) => {
			if (message.type() === 'error') seen.errors.push(message.text());
		});
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

const pathnameOf = (page: Page) => new URL(page.url()).pathname;

describe('React to Vue and back, in place', () => {
	test('both directions swap without a document load', async () => {
		await withPage('/react', async (page, seen) => {
			await page.waitForSelector('#react-page[data-hydrated="true"]', {
				timeout: 15_000
			});

			await page.click('#to-vue');
			await page.waitForFunction(
				() => Reflect.get(window, '__vueHydrated') === true,
				undefined,
				{ timeout: 20_000 }
			);

			expect(pathnameOf(page)).toBe('/vue');
			expect(await sameDocument(page)).toBe(true);
			expect(await page.locator('#react-page').count()).toBe(0);

			// Hydrated, not just swapped in: the server markup is interactive.
			await page.click('#vue-increment');
			await page.waitForFunction(
				() =>
					document
						.getElementById('vue-increment')
						?.textContent?.trim() === 'count 1',
				undefined,
				{ timeout: 10_000 }
			);

			// The hand-off: `<Link>` has no router to match `/react`, so it
			// does not preventDefault and the layer's listener takes it.
			await page.click('#to-react');
			await page.waitForSelector('#react-page[data-hydrated="true"]', {
				timeout: 20_000
			});

			expect(pathnameOf(page)).toBe('/react');
			expect(await sameDocument(page)).toBe(true);
			expect(seen.documentLoads).toEqual([]);
			expect(seen.errors).toEqual([]);
		});
	}, 180_000);

	test('back and forward move between the two', async () => {
		await withPage('/react', async (page, seen) => {
			await page.waitForSelector('#react-page[data-hydrated="true"]', {
				timeout: 15_000
			});
			await page.click('#to-vue');
			await page.waitForFunction(
				() => Reflect.get(window, '__vueHydrated') === true,
				undefined,
				{ timeout: 20_000 }
			);

			await page.goBack();
			await page.waitForSelector('#react-page[data-hydrated="true"]', {
				timeout: 20_000
			});

			expect(pathnameOf(page)).toBe('/react');

			await page.goForward();
			await page.waitForSelector('#vue-page[data-hydrated="true"]', {
				timeout: 20_000
			});

			expect(pathnameOf(page)).toBe('/vue');
			expect(await sameDocument(page)).toBe(true);
			expect(seen.documentLoads).toEqual([]);
		});
	}, 180_000);
});
