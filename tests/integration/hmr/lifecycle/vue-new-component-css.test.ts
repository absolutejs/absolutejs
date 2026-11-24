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
import { openPage, type BrowserSession } from '../../../helpers/browser';
import { ensureDistBuild } from '../../../helpers/ensureDistBuild';
import { getAvailablePort } from '../../../helpers/ports';

/* A Vue component created while `absolute dev` runs, then imported by a
 * component the page already renders: the shape of adding a button to a
 * nav. The hot update served the parent with `rerender()`, which keeps the
 * instance's old `setup()` result, so the new template read `$setup.NewButton`
 * from a setup that never imported it: Vue warned "Invalid vnode type:
 * undefined" and the button never appeared. A script edit now reloads.
 *
 * Both a plain page and a routed page with a layout (onSpark's portal:
 * routes, a layout, its nav), and on each: the open page updates, styled,
 * with no warning, and a fresh load's server HTML carries the new
 * component's scoped styles. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'dist', 'cli', 'index.js');

const NAV = (withChild: boolean) => `<script setup lang="ts">
${withChild ? "import NewButton from './NewButton.vue';\n" : ''}</script>

<template>
	<nav class="site-nav">NAV${withChild ? '<NewButton />' : ''}</nav>
</template>

<style scoped>
.site-nav {
	color: rgb(10, 20, 30);
}
</style>
`;

const NEW_BUTTON = `<template>
	<button class="new-button" type="button">NEW_BUTTON</button>
</template>

<style scoped>
.new-button {
	color: rgb(1, 2, 3);
}
</style>
`;

const FILES: Record<string, string> = {
	'absolute.config.ts': `import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	buildDirectory: './build',
	vueDirectory: './src/frontend/vue'
});
`,
	'package.json': `{ "name": "vue-new-component-css-app", "private": true, "type": "module" }
`,
	'server.ts': `import { Elysia } from 'elysia';
import { asset, networking, prepare } from '@absolutejs/absolute';
import { handleVuePageRequest } from '@absolutejs/absolute/vue';

const { absolutejs, manifest } = await prepare();

const page = (name: string, request: Request) =>
	handleVuePageRequest({
		indexPath: asset(manifest, \`\${name}Index\`),
		pagePath: asset(manifest, name),
		props: {},
		request
	});

export const server = new Elysia()
	.use(absolutejs)
	.get('/', ({ request }) => page('Home', request))
	.get('/portal/*', ({ request }) => page('Portal', request))
	.use(networking);
`,
	'src/frontend/vue/components/Layout.vue': `<script setup lang="ts">
import { RouterView } from 'vue-router';
import PortalNav from './PortalNav.vue';
</script>

<template>
	<div class="layout"><PortalNav /><RouterView /></div>
</template>
`,
	'src/frontend/vue/components/Nav.vue': NAV(false),
	'src/frontend/vue/components/PortalNav.vue': NAV(false).replaceAll(
		'NewButton',
		'PortalButton'
	),
	'src/frontend/vue/components/RouteHome.vue': `<template><p class="route-home">ROUTE_HOME</p></template>
`,
	'src/frontend/vue/pages/Home.vue': `<script setup lang="ts">
import Nav from '../components/Nav.vue';
</script>

<template>
	<main><Nav /></main>
</template>
`,
	'src/frontend/vue/pages/Portal.vue': `<script lang="ts">
import { defineRoutes } from '@absolutejs/absolute/vue';

export const routes = defineRoutes([
	{
		path: '/portal/home',
		component: () => import('../components/RouteHome.vue').then((m) => m.default)
	}
]);
</script>

<script setup lang="ts">
import Layout from '../components/Layout.vue';
</script>

<template><Layout /></template>
`
};

/* Link every package from the repo's node_modules except
 * @absolutejs/absolute, which points at this checkout (its dist/). */
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

type RunningApp = {
	baseUrl: string;
	log: string[];
	root: string;
	server: ReturnType<typeof Bun.spawn>;
};

const collectOutput = async (
	stream: ReadableStream<Uint8Array>,
	log: string[]
) => {
	const decoder = new TextDecoder();
	for await (const chunk of stream) log.push(decoder.decode(chunk));
};

const startApp = async () => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-vue-new-css-'));
	await Promise.all(
		Object.entries(FILES).map(async ([path, contents]) => {
			await mkdir(dirname(join(root, path)), { recursive: true });
			await writeFile(join(root, path), contents);
		})
	);
	await linkNodeModules(root);
	const port = await getAvailablePort();
	const server = Bun.spawn(['bun', CLI_ENTRY, 'dev', 'server.ts'], {
		cwd: root,
		env: {
			...process.env,
			FORCE_COLOR: '0',
			NODE_ENV: 'development',
			PORT: String(port),
			TELEMETRY_OFF: '1'
		},
		stderr: 'pipe',
		stdout: 'pipe'
	});
	const app: RunningApp = {
		baseUrl: `http://localhost:${port}`,
		log: [],
		root,
		server
	};
	void collectOutput(server.stdout as ReadableStream<Uint8Array>, app.log);
	void collectOutput(server.stderr as ReadableStream<Uint8Array>, app.log);
	for (let attempt = 0; attempt < 480; attempt++) {
		if (server.exitCode !== null)
			throw new Error(
				`server exited with ${server.exitCode}: ${app.log.join('')}`
			);
		try {
			const response = await fetch(`${app.baseUrl}/`);
			if (response.ok && (await response.text()).includes('NAV'))
				return app;
		} catch {
			// not listening yet
		}
		await Bun.sleep(250);
	}
	throw new Error(`server did not start: ${app.log.join('')}`);
};

const waitFor = async <T>(
	read: () => Promise<T>,
	done: (value: T) => boolean,
	timeoutMs = 20_000
) => {
	const deadline = Date.now() + timeoutMs;
	let last = await read();
	while (!done(last) && Date.now() < deadline) {
		await Bun.sleep(200);
		last = await read();
	}

	return last;
};

let app: RunningApp | undefined;

beforeAll(async () => {
	await ensureDistBuild();
	app = await startApp();
}, 300_000);

afterAll(async () => {
	app?.server.kill();
	await app?.server.exited;
	if (app) await rm(app.root, { force: true, recursive: true });
});

const running = () => {
	if (!app) throw new Error('dev server is not running');

	return app;
};

const pageHtml = async (path: string) =>
	(await fetch(`${running().baseUrl}${path}`)).text();

type Case = {
	button: string;
	child: string;
	nav: string;
	navSource: string;
	path: string;
};

const CASES: Case[] = [
	{
		button: NEW_BUTTON,
		child: 'NewButton.vue',
		nav: 'Nav.vue',
		navSource: NAV(true),
		path: '/'
	},
	{
		button: NEW_BUTTON,
		child: 'PortalButton.vue',
		nav: 'PortalNav.vue',
		navSource: NAV(true).replaceAll('NewButton', 'PortalButton'),
		path: '/portal/home'
	}
];

describe('a Vue component created while dev runs', () => {
	for (const { button, child, nav, navSource, path } of CASES)
		test(`appears styled on the open page and in every fresh load (${path})`, async () => {
			const { root } = running();
			const errors: string[] = [];
			const session: BrowserSession = await openPage(
				`${running().baseUrl}${path}`,
				{
					waitUntil: 'load',
					consoleLog: (message: string) => {
						if (/warn|error|invalid/i.test(message))
							errors.push(message);
					}
				}
			);
			try {
				const { page } = session;
				await page.waitForSelector('.site-nav', { timeout: 20_000 });

				await writeFile(
					join(root, 'src/frontend/vue/components', child),
					button
				);
				await writeFile(
					join(root, 'src/frontend/vue/components', nav),
					navSource
				);

				// The open page: the new button arrives by hot update, styled.
				await page.waitForSelector('.new-button', { timeout: 30_000 });
				const liveColor = await waitFor(
					() =>
						page.evaluate(() => {
							const element =
								document.querySelector('.new-button');

							return element
								? getComputedStyle(element).color
								: '';
						}),
					(color) => color === 'rgb(1, 2, 3)'
				);
				expect(liveColor).toBe('rgb(1, 2, 3)');
				expect(errors).toEqual([]);
			} finally {
				await session.close();
			}

			// A fresh load: the server HTML carries the new component and its
			// scoped styles (the CSS pipeline writes rgb(1, 2, 3) as #010203).
			const html = await waitFor(
				() => pageHtml(path),
				(body) =>
					body.includes('NEW_BUTTON') && body.includes('#010203')
			);
			expect(html).toContain('NEW_BUTTON');
			expect(html).toContain('#010203');
			expect(html).toContain('#0a141e');
		}, 240_000);
});
