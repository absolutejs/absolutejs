import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
	mkdir,
	mkdtemp,
	readdir,
	rm,
	symlink,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { openPage } from '../../helpers/browser';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';
import { getAvailablePort } from '../../helpers/ports';

/* Production smoke test for an app that uses the published package
 * (`@absolutejs/absolute` linked to this checkout's dist/), so the server
 * bundle `absolute start` writes is the one users get.
 *
 * - A React page that renders a React `<Island>` returned 500 with
 *   `renderToString is not a function`: island SSR used React's legacy
 *   string renderer, which `absolute start` strips out of the server bundle.
 * - A Vue page that exports `routes` returned 500 with
 *   `__VUE_PROD_DEVTOOLS__ is not defined`: vue-router is inlined into the
 *   SSR page bundle and reads Vue's feature flags, which the server build
 *   pass didn't define. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'dist', 'cli', 'index.js');

const FILES: Record<string, string> = {
	'absolute.config.ts': `import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	buildDirectory: './build',
	islands: { registry: './islands/registry.ts' },
	reactDirectory: './react',
	svelteDirectory: './svelte',
	vueDirectory: './vue'
});
`,
	'islands/ReactCounter.tsx': `import { useState } from 'react';

export const ReactCounter = ({ start }: { start: number }) => {
	const [count, setCount] = useState(start);

	return (
		<button className="react-island" onClick={() => setCount(count + 1)} type="button">
			REACT_ISLAND {count}
		</button>
	);
};
`,
	'islands/registry.ts': `import { defineIslandRegistry } from '@absolutejs/absolute/islands';
import { ReactCounter } from './ReactCounter';
import SvelteCounter from '../svelte/components/SvelteCounter.svelte';

export const islandRegistry = defineIslandRegistry({
	react: { ReactCounter },
	svelte: { SvelteCounter }
});
`,
	'react/pages/IslandsPage.tsx': `import { Island } from '@absolutejs/absolute/react';

export const IslandsPage = () => (
	<html>
		<head>
			<meta charSet="utf-8" />
			<title>Islands</title>
		</head>
		<body>
			<h1>ISLANDS_PAGE</h1>
			<Island component="ReactCounter" framework="react" props={{ start: 3 }} />
			<Island component="SvelteCounter" framework="svelte" props={{ start: 5 }} />
		</body>
	</html>
);
`,
	'server.ts': `import { Elysia } from 'elysia';
import { asset, networking, prepare } from '@absolutejs/absolute';
import { handleReactPageRequest } from '@absolutejs/absolute/react';
import { handleVuePageRequest } from '@absolutejs/absolute/vue';
import { IslandsPage } from './react/pages/IslandsPage';

const { absolutejs, manifest } = await prepare();

const shell = (request: Request) =>
	handleVuePageRequest({
		indexPath: asset(manifest, 'ShellIndex'),
		pagePath: asset(manifest, 'Shell'),
		props: {},
		request
	});

export const server = new Elysia()
	.use(absolutejs)
	.onError(({ error }) => {
		console.error('ROUTE_ERROR', error instanceof Error ? error.stack : error);
	})
	.get('/islands', () =>
		handleReactPageRequest({
			index: asset(manifest, 'IslandsPageIndex'),
			Page: IslandsPage,
			props: {}
		})
	)
	.get('/shell', ({ request }) => shell(request))
	.get('/shell/*', ({ request }) => shell(request))
	.use(networking);
`,
	'svelte/components/SvelteCounter.svelte': `<script lang="ts">
	let { start }: { start: number } = $props();
	let count = $state(start);
</script>

<button class="svelte-island" onclick={() => (count += 1)} type="button">SVELTE_ISLAND {count}</button>
`,
	'vue/pages/RouteOne.vue': `<template>
	<section class="route-one">ROUTE_ONE_CONTENT</section>
</template>
`,
	'vue/pages/RouteTwo.vue': `<template>
	<section class="route-two">ROUTE_TWO_CONTENT</section>
</template>
`,
	'vue/pages/Shell.vue': `<script lang="ts">
import { defineRoutes } from '@absolutejs/absolute/vue';

export const routes = defineRoutes([
	{
		component: () => import('./RouteOne.vue').then((mod) => mod.default),
		path: '/shell/one'
	},
	{
		component: () => import('./RouteTwo.vue').then((mod) => mod.default),
		path: '/shell/two'
	},
	{ path: '/shell', redirect: '/shell/one' }
]);
</script>

<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router';
</script>

<template>
	<main class="shell">
		<h1>SHELL</h1>
		<RouterLink class="to-two" to="/shell/two">Two</RouterLink>
		<RouterView />
	</main>
</template>
`
};

/* The repo's node_modules may hold an older published
 * @absolutejs/absolute; link every package from it except that one, which
 * points at this checkout (its dist/). */
const linkNodeModules = async (projectRoot: string) => {
	const source = join(repoRoot, 'node_modules');
	const target = join(projectRoot, 'node_modules');
	await mkdir(join(target, '@absolutejs'), { recursive: true });
	const [entries, scoped] = await Promise.all([
		readdir(source),
		readdir(join(source, '@absolutejs'))
	]);
	await Promise.all([
		...entries
			.filter((name) => name !== '@absolutejs' && name !== '.bin')
			.map((name) => symlink(join(source, name), join(target, name))),
		...scoped
			.filter((name) => name !== 'absolute' && !name.startsWith('.'))
			.map((name) =>
				symlink(
					join(source, '@absolutejs', name),
					join(target, '@absolutejs', name)
				)
			),
		symlink(repoRoot, join(target, '@absolutejs', 'absolute'))
	]);
};

let root = '';
let baseUrl = '';
let server: ReturnType<typeof Bun.spawn> | undefined;

const waitForServer = async () => {
	for (let attempt = 0; attempt < 480; attempt++) {
		if (server?.exitCode !== null && server?.exitCode !== undefined)
			throw new Error(`absolute start exited with ${server.exitCode}`);
		try {
			await fetch(`${baseUrl}/islands`);

			return;
		} catch {
			await Bun.sleep(250);
		}
	}
	throw new Error('production server did not start');
};

beforeAll(async () => {
	await ensureDistBuild();
	root = await mkdtemp(join(tmpdir(), 'absolute-prod-islands-router-'));
	await Promise.all(
		Object.entries(FILES).map(async ([path, contents]) => {
			await mkdir(dirname(join(root, path)), { recursive: true });
			await writeFile(join(root, path), contents);
		})
	);
	await linkNodeModules(root);
	const port = await getAvailablePort();
	baseUrl = `http://localhost:${port}`;
	server = Bun.spawn(
		['bun', CLI_ENTRY, 'start', 'server.ts', '--outdir', 'start-build'],
		{
			cwd: root,
			env: {
				...process.env,
				FORCE_COLOR: '0',
				NODE_ENV: 'production',
				PORT: String(port),
				TELEMETRY_OFF: '1'
			},
			stderr: 'inherit',
			stdout: 'ignore'
		}
	);
	await waitForServer();
}, 600_000);

afterAll(async () => {
	server?.kill();
	await server?.exited;
	if (root) await rm(root, { force: true, recursive: true });
});

describe('production smoke: islands and the Vue router', () => {
	test('a React page with React and Svelte islands renders both on the server', async () => {
		const response = await fetch(`${baseUrl}/islands`);
		const html = await response.text();

		expect(response.status).toBe(200);
		expect(html).toContain('ISLANDS_PAGE');
		expect(html).toMatch(
			/class="react-island"[^>]*>REACT_ISLAND <!-- -->3</
		);
		expect(html).toContain('SVELTE_ISLAND 5');
	});

	test('both islands hydrate in the browser', async () => {
		const errors: string[] = [];
		const session = await openPage(`${baseUrl}/islands`);
		try {
			const { page } = session;
			page.on('pageerror', (error) => errors.push(error.message));
			await page.waitForSelector(
				'[data-island="true"][data-component="ReactCounter"][data-hydrated="true"]',
				{ timeout: 20_000 }
			);
			await page.waitForSelector(
				'[data-island="true"][data-component="SvelteCounter"][data-hydrated="true"]',
				{ timeout: 20_000 }
			);
			await page.click('.react-island');
			await page.click('.svelte-island');
			await page.waitForFunction(
				() =>
					document.querySelector('.react-island')?.textContent ===
						'REACT_ISLAND 4' &&
					document.querySelector('.svelte-island')?.textContent ===
						'SVELTE_ISLAND 6',
				undefined,
				{ timeout: 10_000 }
			);
			expect(errors).toEqual([]);
		} finally {
			await session.close();
		}
	}, 60_000);

	test('a Vue page exporting routes renders a direct nested URL', async () => {
		const response = await fetch(`${baseUrl}/shell/one`);
		const html = await response.text();

		expect(response.status).toBe(200);
		expect(html).toContain('<div id="root">');
		expect(html).not.toContain('is not defined');
	});

	test('the Vue router page mounts the nested route and navigates client-side', async () => {
		const errors: string[] = [];
		const session = await openPage(`${baseUrl}/shell/one`);
		try {
			const { page } = session;
			page.on('pageerror', (error) => errors.push(error.message));
			await page.waitForSelector('.route-one', { timeout: 20_000 });
			// A full page load would drop this marker.
			await page.evaluate(() => {
				Reflect.set(window, '__navigationMarker', true);
			});
			await page.click('.to-two');
			await page.waitForSelector('.route-two', { timeout: 20_000 });

			expect(await page.textContent('.route-two')).toBe(
				'ROUTE_TWO_CONTENT'
			);
			expect(new URL(page.url()).pathname).toBe('/shell/two');
			expect(
				await page.evaluate(() =>
					Reflect.get(window, '__navigationMarker')
				)
			).toBe(true);
			expect(errors).toEqual([]);
		} finally {
			await session.close();
		}
	}, 60_000);
});
