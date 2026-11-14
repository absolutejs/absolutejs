import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Page } from 'playwright';
import { openPage } from '../../helpers/browser';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';
import { getAvailablePort } from '../../helpers/ports';

/* Island styles under secureHeaders(), in dev and in production.
 *
 * - A Svelte island with a <style> block was compiled with `css:
 *   'injected'`: its runtime appended an inline <style> on every load,
 *   which the nonce-based style-src refused, so the island rendered
 *   unstyled with a CSP violation on every host page.
 * - A Vue island's <style scoped> was compiled to a file nothing bundled
 *   or linked, so it never reached the page at all.
 *
 * Both now build into the island's own stylesheet, which the server links
 * from the host page, with the request's nonce: in the head of a whole
 * document (HTML, HTMX, Svelte, Vue), as a hoisted stylesheet resource on
 * a React page, and next to the island on a streamed Vue page. Each island
 * must show its styles (a child component's too) with no CSP violation and
 * no hydration warning; a page links only the islands it renders, and an
 * island rendered twice is linked once. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'dist', 'cli', 'index.js');

const RED = 'rgb(255, 0, 0)';
const GREEN = 'rgb(0, 128, 0)';
const BLUE = 'rgb(0, 0, 255)';
const PURPLE = 'rgb(128, 0, 128)';

const ORANGE = 'rgb(255, 165, 0)';

const islandMarkup = `<absolute-island framework="svelte" component="SvelteStyled" props='{"start":1}'></absolute-island>
		<absolute-island framework="vue" component="VueStyled" props='{"start":2}'></absolute-island>
		<absolute-island framework="svelte" component="SvelteStyled" props='{"start":5}'></absolute-island>`;

const staticPage = (title: string) => `<!doctype html>
<html>
	<head>
		<meta charset="utf-8" />
		<title>${title}</title>
	</head>
	<body>
		<h1>${title}</h1>
		${islandMarkup}
	</body>
</html>
`;

const FILES: Record<string, string> = {
	'absolute.config.ts': `import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	buildDirectory: 'build',
	htmlDirectory: 'src/frontend/html',
	htmxDirectory: 'src/frontend/htmx',
	islands: { registry: 'src/islands/registry.ts' },
	reactDirectory: 'src/frontend/react',
	svelteDirectory: 'src/frontend/svelte',
	vueDirectory: 'src/frontend/vue'
});
`,
	'package.json': `{ "name": "island-styles-app", "private": true, "type": "module" }
`,
	'src/backend/server.ts': `import { Elysia } from 'elysia';
import {
	asset,
	handleHTMLPageRequest,
	handleHTMXPageRequest,
	networking,
	prepare,
	secureHeaders
} from '@absolutejs/absolute';
import { handleReactPageRequest } from '@absolutejs/absolute/react';
import { handleSveltePageRequest } from '@absolutejs/absolute/svelte';
import { handleVuePageRequest } from '@absolutejs/absolute/vue';
import { IslandsPage } from '../frontend/react/pages/IslandsPage';
import { SvelteOnlyPage } from '../frontend/react/pages/SvelteOnlyPage';

const { absolutejs, manifest } = await prepare();

export const server = new Elysia()
	.use(secureHeaders())
	.use(absolutejs)
	.get('/react', () =>
		handleReactPageRequest({
			index: asset(manifest, 'IslandsPageIndex'),
			Page: IslandsPage,
			props: {}
		})
	)
	.get('/react-svelte-only', () =>
		handleReactPageRequest({
			index: asset(manifest, 'SvelteOnlyPageIndex'),
			Page: SvelteOnlyPage,
			props: {}
		})
	)
	.get('/svelte', () =>
		handleSveltePageRequest({
			indexPath: asset(manifest, 'SvelteIslandsIndex'),
			pagePath: asset(manifest, 'SvelteIslands')
		})
	)
	.get('/vue', () =>
		handleVuePageRequest({
			indexPath: asset(manifest, 'VueIslandsIndex'),
			pagePath: asset(manifest, 'VueIslands'),
			props: {}
		})
	)
	.get('/vue-stream', () =>
		handleVuePageRequest({
			collectStreamingSlots: true,
			indexPath: asset(manifest, 'VueStreamIslandsIndex'),
			pagePath: asset(manifest, 'VueStreamIslands'),
			props: {}
		})
	)
	.get('/html', () => handleHTMLPageRequest(asset(manifest, 'HtmlIslands')))
	.get('/htmx', () => handleHTMXPageRequest(asset(manifest, 'HtmxIslands')))
	.use(networking);
`,
	'src/frontend/html/pages/HtmlIslands.html': staticPage('HTML_ISLANDS'),
	'src/frontend/htmx/pages/HtmxIslands.html': staticPage('HTMX_ISLANDS'),
	'src/frontend/react/pages/IslandsPage.tsx': `import { Island } from '@absolutejs/absolute/react';

export const IslandsPage = () => (
	<html>
		<head>
			<meta charSet="utf-8" />
			<title>Islands</title>
		</head>
		<body>
			<h1>REACT_ISLANDS</h1>
			<Island component="SvelteStyled" framework="svelte" props={{ start: 1 }} />
			<Island component="VueStyled" framework="vue" props={{ start: 2 }} />
			<Island component="SvelteStyled" framework="svelte" props={{ start: 5 }} />
		</body>
	</html>
);
`,
	'src/frontend/react/pages/SvelteOnlyPage.tsx': `import { Island } from '@absolutejs/absolute/react';

export const SvelteOnlyPage = () => (
	<html>
		<head>
			<meta charSet="utf-8" />
			<title>Svelte only</title>
		</head>
		<body>
			<h1>REACT_SVELTE_ONLY</h1>
			<Island component="SvelteStyled" framework="svelte" props={{ start: 1 }} />
		</body>
	</html>
);
`,
	'src/frontend/svelte/pages/SvelteIslands.svelte': `<h1>SVELTE_ISLANDS</h1>
<Island framework="svelte" component="SvelteStyled" props={{ start: 1 }} />
<Island framework="vue" component="VueStyled" props={{ start: 2 }} />
<Island framework="svelte" component="SvelteStyled" props={{ start: 5 }} />
`,
	'src/frontend/vue/pages/VueIslands.vue': `<script setup lang="ts">
import { Island } from '@absolutejs/absolute/vue';
</script>

<template>
	<main>
		<h1>VUE_ISLANDS</h1>
		<Island framework="svelte" component="SvelteStyled" :props="{ start: 1 }" />
		<Island framework="vue" component="VueStyled" :props="{ start: 2 }" />
		<Island framework="svelte" component="SvelteStyled" :props="{ start: 1 }" />
	</main>
</template>
`,
	'src/frontend/vue/pages/VueStreamIslands.vue': `<script setup lang="ts">
import { Island } from '@absolutejs/absolute/vue';
</script>

<template>
	<main>
		<h1>VUE_STREAM_ISLANDS</h1>
		<section>
			<Island framework="svelte" component="SvelteStyled" :props="{ start: 1 }" />
		</section>
		<Island framework="svelte" component="SvelteStyled" :props="{ start: 1 }" />
	</main>
</template>
`,
	'src/islands/Badge.svelte': `<span class="badge">BADGE</span>

<style>
	.badge {
		color: ${GREEN};
	}
</style>
`,
	'src/islands/registry.ts': `import { defineIslandRegistry } from '@absolutejs/absolute/islands';
import SvelteStyled from './SvelteStyled.svelte';
import VueStyled from './VueStyled.vue';

export const islandRegistry = defineIslandRegistry({
	svelte: { SvelteStyled },
	vue: { VueStyled }
});
`,
	'src/islands/SvelteStyled.svelte': `<script lang="ts">
	import Badge from './Badge.svelte';

	let { start }: { start: number } = $props();
	let count = $state(start);
</script>

<button class="svelte-island" onclick={() => (count += 1)} type="button">SVELTE_ISLAND {count}</button>
<Badge />

<style>
	.svelte-island {
		color: ${RED};
	}
</style>
`,
	'src/islands/VueStyled.vue': `<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{ start: number }>();
const count = ref(props.start);
</script>

<template>
	<button class="vue-island" type="button" @click="count++">VUE_ISLAND {{ count }}</button>
</template>

<style scoped>
.vue-island {
	color: ${BLUE};
}
</style>
`,
	'tsconfig.json': `{
	"compilerOptions": {
		"jsx": "react-jsx",
		"module": "esnext",
		"moduleResolution": "bundler",
		"skipLibCheck": true,
		"strict": true,
		"target": "esnext"
	}
}
`
};

type IslandName = 'SvelteStyled' | 'VueStyled';

type HostRoute = {
	/** Islands the page renders, which it must link (once each). */
	islands: IslandName[];
	path: string;
};

const ROUTES: HostRoute[] = [
	{ islands: ['SvelteStyled', 'VueStyled'], path: '/react' },
	{ islands: ['SvelteStyled'], path: '/react-svelte-only' },
	{ islands: ['SvelteStyled', 'VueStyled'], path: '/svelte' },
	{ islands: ['SvelteStyled', 'VueStyled'], path: '/vue' },
	{ islands: ['SvelteStyled'], path: '/vue-stream' },
	{ islands: ['SvelteStyled', 'VueStyled'], path: '/html' },
	{ islands: ['SvelteStyled', 'VueStyled'], path: '/htmx' }
];

const ISLAND_NAMES: IslandName[] = ['SvelteStyled', 'VueStyled'];

const STYLE_KEYS: Record<IslandName, string> = {
	SvelteStyled: 'IslandStyleSvelteSvelteStyled',
	VueStyled: 'IslandStyleVueVueStyled'
};

const STYLE_HREFS: Record<IslandName, RegExp> = {
	SvelteStyled: /^\/islands\/svelte\/SvelteStyled\.[^"]+\.css$/,
	VueStyled: /^\/islands\/vue\/VueStyled\.[^"]+\.css$/
};

const ISLAND_COLORS: Record<IslandName, [string, string]> = {
	SvelteStyled: ['.svelte-island', RED],
	VueStyled: ['.vue-island', BLUE]
};

/* <link> tags the server sent for an island's stylesheet. */
const findStyleLinkTags = (html: string, island: IslandName) =>
	Array.from(html.matchAll(/<link\b[^>]*>/g), ([tag]) => tag).filter(
		(tag) => {
			const href = /\bhref="([^"]*)"/.exec(tag)?.[1] ?? '';

			return STYLE_HREFS[island].test(href);
		}
	);

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

const createProject = async (prefix: string) => {
	const root = await mkdtemp(join(tmpdir(), prefix));
	await Promise.all(
		Object.entries(FILES).map(async ([path, contents]) => {
			await mkdir(dirname(join(root, path)), { recursive: true });
			await writeFile(join(root, path), contents);
		})
	);
	await linkNodeModules(root);

	return root;
};

type RunningApp = {
	baseUrl: string;
	root: string;
	server: ReturnType<typeof Bun.spawn>;
};

const startApp = async (prefix: string, args: string[], nodeEnv: string) => {
	const root = await createProject(prefix);
	const port = await getAvailablePort();
	const baseUrl = `http://localhost:${port}`;
	const server = Bun.spawn(['bun', CLI_ENTRY, ...args], {
		cwd: root,
		env: {
			...process.env,
			FORCE_COLOR: '0',
			NODE_ENV: nodeEnv,
			PORT: String(port),
			TELEMETRY_OFF: '1'
		},
		stderr: 'inherit',
		stdout: 'ignore'
	});
	for (let attempt = 0; attempt < 480; attempt++) {
		if (server.exitCode !== null)
			throw new Error(
				`absolute ${args[0]} exited with ${server.exitCode}`
			);
		try {
			const response = await fetch(`${baseUrl}/react`);
			if (response.ok) {
				const app: RunningApp = { baseUrl, root, server };

				return app;
			}
		} catch {
			// not listening yet
		}
		await Bun.sleep(250);
	}
	throw new Error(`absolute ${args[0]} did not start`);
};

const stopApp = async (app: RunningApp | undefined) => {
	if (!app) return;
	app.server.kill();
	await app.server.exited;
	await rm(app.root, { force: true, recursive: true });
};

const colorOf = (page: Page, selector: string) =>
	page.evaluate((target) => {
		const element = document.querySelector(target);

		return element ? getComputedStyle(element).color : null;
	}, selector);

const isCspMessage = (message: string) =>
	/Content Security Policy|violates the following/i.test(message);

const isHydrationMessage = (message: string) =>
	/hydrat|mismatch|did not match|Minified React error #(418|419|423|425)/i.test(
		message
	);

const waitForColor = (page: Page, selector: string, color: string) =>
	page.waitForFunction(
		([target, expected]) => {
			const element = document.querySelector(target ?? '');

			return (
				element !== null && getComputedStyle(element).color === expected
			);
		},
		[selector, color],
		{ timeout: 30_000 }
	);

/* Every host page: the server links the stylesheet of each island it
 * renders, once, with the request's nonce, and no other island's; the
 * islands hydrate, their styles apply, and the browser reports neither a
 * CSP violation nor a hydration warning. */
const expectStyledIslands = async (baseUrl: string) => {
	for (const { islands, path } of ROUTES) {
		const response = await fetch(`${baseUrl}${path}`);
		const policy = response.headers.get('content-security-policy') ?? '';
		expect(policy).toContain("style-src 'self' 'nonce-");
		const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
		const html = await response.text();
		for (const island of ISLAND_NAMES) {
			const tags = findStyleLinkTags(html, island);
			expect({ count: tags.length, island, path }).toEqual({
				count: islands.includes(island) ? 1 : 0,
				island,
				path
			});
			for (const tag of tags) {
				expect(tag).toContain(`nonce="${nonce}"`);
				expect(tag).toContain(
					`data-island-style="${STYLE_KEYS[island]}"`
				);
			}
		}

		const messages: string[] = [];
		const session = await openPage(`${baseUrl}${path}`, {
			consoleLog: (message) => messages.push(message)
		});
		const { page } = session;
		page.on('pageerror', (error) => messages.push(error.message));
		try {
			await page.waitForFunction(
				() =>
					Array.from(
						document.querySelectorAll('[data-island="true"]')
					).every(
						(element) =>
							element.getAttribute('data-hydrated') === 'true'
					),
				undefined,
				{ timeout: 30_000 }
			);
			expect({
				badge: await colorOf(page, '.badge'),
				path,
				...Object.fromEntries(
					await Promise.all(
						islands.map(async (island) => [
							island,
							await colorOf(page, ISLAND_COLORS[island][0])
						])
					)
				)
			}).toEqual({
				badge: GREEN,
				path,
				...Object.fromEntries(
					islands.map((island) => [island, ISLAND_COLORS[island][1]])
				)
			});
			// Hydrating the host adds no second link, and an island the
			// page does not render is never linked.
			expect(
				await page.evaluate(
					(keys) =>
						keys.map(
							(key) =>
								document.querySelectorAll(
									`link[data-island-style="${key}"]`
								).length
						),
					ISLAND_NAMES.map((island) => STYLE_KEYS[island])
				)
			).toEqual(
				ISLAND_NAMES.map((island) => (islands.includes(island) ? 1 : 0))
			);

			// Still interactive after hydration.
			const withVue = islands.includes('VueStyled');
			await page.click('.svelte-island');
			if (withVue) await page.click('.vue-island');
			await page.waitForFunction(
				(expectVue) =>
					document.querySelector('.svelte-island')?.textContent ===
						'SVELTE_ISLAND 2' &&
					(!expectVue ||
						document.querySelector('.vue-island')?.textContent ===
							'VUE_ISLAND 3'),
				withVue,
				{ timeout: 10_000 }
			);
			// No runtime-injected inline <style> either.
			expect(
				await page.evaluate(
					() => document.querySelectorAll('style:not([nonce])').length
				)
			).toBe(0);
			await Bun.sleep(500);
			expect({ csp: messages.filter(isCspMessage), path }).toEqual({
				csp: [],
				path
			});
			expect({
				hydration: messages.filter(isHydrationMessage),
				path
			}).toEqual({ hydration: [], path });
		} finally {
			await session.close();
		}
	}
};

/* Dev: editing the Svelte island's style swaps its stylesheet in place,
 * wherever the server put the link, without a reload. */
const expectStyleSwap = async (
	app: RunningApp,
	path: string,
	from: string,
	to: string
) => {
	const messages: string[] = [];
	const session = await openPage(`${app.baseUrl}${path}`, {
		consoleLog: (message) => messages.push(message)
	});
	const { page } = session;
	try {
		await page.waitForSelector(
			'[data-island="true"][data-component="SvelteStyled"][data-hydrated="true"]',
			{ timeout: 30_000 }
		);
		const linkParents = () =>
			page.evaluate(
				(key) =>
					Array.from(
						document.querySelectorAll(
							`link[data-island-style="${key}"]`
						),
						(link) => link.parentElement?.tagName ?? null
					),
				STYLE_KEYS.SvelteStyled
			);
		const parentsBefore = await linkParents();
		await page.evaluate(() => Reflect.set(window, '__noReload', true));
		const file = join(app.root, 'src/islands/SvelteStyled.svelte');
		const source = await readFile(file, 'utf-8');
		await writeFile(file, source.replace(from, to));
		await waitForColor(page, '.svelte-island', to);
		expect(
			await page.evaluate(() => Reflect.get(window, '__noReload'))
		).toBe(true);
		await page.waitForFunction(
			(key) =>
				document.querySelectorAll(`link[data-island-style="${key}"]`)
					.length === 1,
			STYLE_KEYS.SvelteStyled,
			{ timeout: 10_000 }
		);
		expect({ parents: await linkParents(), path }).toEqual({
			parents: parentsBefore,
			path
		});
		expect(messages.filter(isCspMessage)).toEqual([]);
	} finally {
		await session.close();
	}
};

describe('island styles under secureHeaders() in production', () => {
	let app: RunningApp | undefined;

	beforeAll(async () => {
		await ensureDistBuild();
		app = await startApp(
			'absolute-island-styles-prod-',
			['start', 'src/backend/server.ts', '--outdir', 'start-build'],
			'production'
		);
	}, 600_000);

	afterAll(() => stopApp(app));

	test('Svelte and Vue island styles apply on React, Svelte, Vue, HTML and HTMX hosts with no CSP violation', async () => {
		if (!app) throw new Error('app did not start');
		await expectStyledIslands(app.baseUrl);
	}, 300_000);
});

describe('island styles under secureHeaders() in dev', () => {
	let app: RunningApp | undefined;

	beforeAll(async () => {
		await ensureDistBuild();
		app = await startApp(
			'absolute island styles dev ',
			['dev'],
			'development'
		);
	}, 600_000);

	afterAll(() => stopApp(app));

	test('Svelte and Vue island styles apply on React, Svelte, Vue, HTML and HTMX hosts with no CSP violation', async () => {
		if (!app) throw new Error('app did not start');
		await expectStyledIslands(app.baseUrl);
	}, 300_000);

	test('an island style edit swaps the stylesheet in place', async () => {
		if (!app) throw new Error('app did not start');
		await expectStyleSwap(app, '/react', RED, PURPLE);
	}, 120_000);

	test('an island style edit swaps a stylesheet linked next to the island', async () => {
		if (!app) throw new Error('app did not start');
		await expectStyleSwap(app, '/vue-stream', PURPLE, ORANGE);
	}, 120_000);
});
