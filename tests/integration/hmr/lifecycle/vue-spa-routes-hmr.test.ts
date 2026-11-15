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
import { openPage, type BrowserSession } from '../../../helpers/browser';
import { ensureDistBuild } from '../../../helpers/ensureDistBuild';
import { getAvailablePort } from '../../../helpers/ports';

/* Editing a Vue page's `export const routes = defineRoutes([...])` in
 * `absolute dev`. The SPA route table the server consults (404 for a path no
 * SPA host declares) was computed only by `build()`, which the Vue fast path
 * skips, and the live client router kept its boot-time table. So a route
 * added to the page answered 404 until dev restarted, a removed route kept
 * rendering, nothing was logged, and a browser already on the page could not
 * navigate to the new route without a full load.
 *
 * Covers a plain `<script lang="ts">` shell and a shell pairing
 * `<script setup>` (first) with the module-level `<script>` that exports
 * `routes`. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'dist', 'cli', 'index.js');

const routeComponent = (name: string, text: string) => `<template>
	<section class="${name}">${text}</section>
</template>
`;

const PLAIN_SHELL = `<script lang="ts">
import { defineRoutes } from '@absolutejs/absolute/vue';

export const routes = defineRoutes([
	{
		path: '/app/one',
		component: () => import('../components/RouteOne.vue').then((m) => m.default)
	},
	{
		path: '/app/two',
		component: () => import('../components/RouteTwo.vue').then((m) => m.default)
	},
	{ path: '/app', redirect: '/app/one' }
]);
</script>

<template><RouterView /></template>
`;

const SETUP_SHELL = `<script setup lang="ts">
const label = 'SETUP_SHELL';
</script>

<script lang="ts">
import { defineRoutes } from '@absolutejs/absolute/vue';

export const routes = defineRoutes([
	{
		path: '/alt/one',
		component: () => import('../components/RouteOne.vue').then((m) => m.default)
	},
	{
		path: '/alt/two',
		component: () => import('../components/RouteTwo.vue').then((m) => m.default)
	}
]);
</script>

<template>
	<p class="shell-label">{{ label }}</p>
	<RouterView />
</template>
`;

const THREE_ROUTE = (prefix: string) => `{
		path: '/${prefix}/three',
		component: () => import('../components/RouteThree.vue').then((m) => m.default)
	},
	`;

const FILES: Record<string, string> = {
	'absolute.config.ts': `import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	buildDirectory: './build',
	vueDirectory: './src/frontend/vue'
});
`,
	'package.json': `{ "name": "vue-spa-routes-hmr-app", "private": true, "type": "module" }
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
	.get('/health', () => 'ok')
	.get('/app', ({ request }) => page('RoutedShell', request))
	.get('/app/*', ({ request }) => page('RoutedShell', request))
	.get('/alt/*', ({ request }) => page('SetupShell', request))
	.use(networking);
`,
	'src/frontend/vue/components/RouteOne.vue': routeComponent(
		'route-one',
		'ROUTE_ONE'
	),
	'src/frontend/vue/components/RouteThree.vue': routeComponent(
		'route-three',
		'ROUTE_THREE'
	),
	'src/frontend/vue/components/RouteTwo.vue': routeComponent(
		'route-two',
		'ROUTE_TWO'
	),
	'src/frontend/vue/pages/RoutedShell.vue': PLAIN_SHELL,
	'src/frontend/vue/pages/SetupShell.vue': SETUP_SHELL
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
	const root = await mkdtemp(join(tmpdir(), 'absolute-vue-spa-routes-'));
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
			const response = await fetch(`${app.baseUrl}/app/one`);
			if (response.ok) return app;
		} catch {
			// not listening yet
		}
		await Bun.sleep(250);
	}
	throw new Error(`server did not start: ${app.log.join('')}`);
};

const fetchStatus = async (url: string) => {
	const response = await fetch(url);
	const body = await response.text();

	return { body, status: response.status };
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

type LiveRouter = {
	push: (path: string) => Promise<unknown>;
	resolve: (path: string) => { matched: unknown[] };
};

type LiveApp = { config?: { globalProperties?: { $router?: LiveRouter } } };

/* The helpers below run in the browser (Playwright serializes each one), so
 * each reads the live app's router itself. */
const routerResolves = (path: string) => {
	const liveApp: unknown = Reflect.get(window, '__VUE_APP__');
	const router = (liveApp as LiveApp | null | undefined)?.config
		?.globalProperties?.$router;

	return router ? router.resolve(path).matched.length > 0 : false;
};

const routerDropped = (path: string) => {
	const liveApp: unknown = Reflect.get(window, '__VUE_APP__');
	const router = (liveApp as LiveApp | null | undefined)?.config
		?.globalProperties?.$router;

	return router ? router.resolve(path).matched.length === 0 : false;
};

const routerPush = async (path: string) => {
	const liveApp: unknown = Reflect.get(window, '__VUE_APP__');
	await (
		liveApp as LiveApp | null | undefined
	)?.config?.globalProperties?.$router?.push(path);
};

// eslint-disable-next-line no-control-regex
const stripAnsi = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '');

describe('dev: editing a Vue page’s defineRoutes', () => {
	let app: RunningApp | undefined;
	let session: BrowserSession | undefined;
	const url = (path: string) => `${app?.baseUrl ?? ''}${path}`;
	const pagePath = (name: string) =>
		join(app?.root ?? '', 'src/frontend/vue/pages', `${name}.vue`);
	const editPage = async (name: string, edit: (source: string) => string) => {
		const path = pagePath(name);
		await writeFile(path, edit(await readFile(path, 'utf-8')));
	};
	const logText = () => stripAnsi(app?.log.join('') ?? '');

	beforeAll(async () => {
		await ensureDistBuild();
		app = await startApp();
	}, 600_000);

	afterAll(async () => {
		await session?.close();
		if (!app) return;
		app.server.kill();
		await app.server.exited;
		await rm(app.root, { force: true, recursive: true });
	});

	test('an added route answers 200 and is navigable without a reload', async () => {
		const errors: string[] = [];
		session = await openPage(url('/app/one'), {
			consoleLog: (message) => {
				if (/error/i.test(message)) errors.push(message);
			}
		});
		const { page } = session;
		page.on('pageerror', (error) => errors.push(error.message));
		await page.waitForSelector('.route-one', { timeout: 30_000 });
		// Let the HMR socket connect before editing.
		await Bun.sleep(1_500);
		await page.evaluate(() =>
			Reflect.set(window, '__routesMarker', 'kept')
		);

		expect((await fetchStatus(url('/app/three'))).status).toBe(404);

		await editPage('RoutedShell', (source) =>
			source.replace(
				"{ path: '/app', redirect",
				`${THREE_ROUTE('app')}{ path: '/app', redirect`
			)
		);

		// A SPA shell ships an empty #root (the client renders the route), so
		// the server's answer is the status: 404 while the route is unknown.
		// The server still runs the page's router (`setupApp` pushes the
		// request URL): the route table must not admit the path before that
		// router knows it, or the server renders the pre-edit router —
		// `[Vue Router warn]: No match found` and the 404 page.
		const three = await waitFor(
			() => fetchStatus(url('/app/three')),
			(result) => result.status === 200
		);
		expect(three.status).toBe(200);
		expect(logText()).toMatch(
			/routes update \/\S*RoutedShell\.vue \+\/app\/three/
		);
		expect(logText()).not.toContain('No match found');
		// The same shell any known route of the page gets, as after a restart.
		expect(three.body).toBe((await fetchStatus(url('/app/one'))).body);
		expect(three.body).toContain('<div id="root"></div>');

		// The live router picks up the new table: navigate client-side.
		await page.waitForFunction(routerResolves, '/app/three', {
			polling: 200,
			timeout: 20_000
		});
		await page.evaluate(routerPush, '/app/three');
		await page.waitForSelector('.route-three', { timeout: 20_000 });
		expect(await page.textContent('.route-three')).toBe('ROUTE_THREE');
		expect(new URL(page.url()).pathname).toBe('/app/three');
		expect(
			await page.evaluate(() => Reflect.get(window, '__routesMarker'))
		).toBe('kept');
		expect(errors).toEqual([]);
	}, 120_000);

	test('a removed route answers 404', async () => {
		expect((await fetchStatus(url('/app/two'))).status).toBe(200);
		await editPage('RoutedShell', (source) =>
			source.replace(/\t\{\n\t\tpath: '\/app\/two',[\s\S]*?\n\t\},\n/, '')
		);
		const two = await waitFor(
			() => fetchStatus(url('/app/two')),
			(result) => result.status === 404
		);
		expect(two.status).toBe(404);
		expect(logText()).toMatch(
			/routes update \/\S*RoutedShell\.vue -\/app\/two/
		);
		expect((await fetchStatus(url('/app/one'))).status).toBe(200);
		expect((await fetchStatus(url('/app/three'))).status).toBe(200);

		// The open page (on /app/three) drops the route without reloading.
		const page = session?.page;
		if (!page) throw new Error('no browser session');
		await page.waitForFunction(routerDropped, '/app/two', {
			polling: 200,
			timeout: 20_000
		});
		expect(await page.textContent('.route-three')).toBe('ROUTE_THREE');
		expect(
			await page.evaluate(() => Reflect.get(window, '__routesMarker'))
		).toBe('kept');
	}, 60_000);

	test('a <script setup> shell picks up an added route', async () => {
		expect((await fetchStatus(url('/alt/one'))).status).toBe(200);
		expect((await fetchStatus(url('/alt/three'))).status).toBe(404);
		await editPage('SetupShell', (source) =>
			source.replace(
				'defineRoutes([\n\t',
				`defineRoutes([\n\t${THREE_ROUTE('alt')}`
			)
		);
		const three = await waitFor(
			() => fetchStatus(url('/alt/three')),
			(result) => result.status === 200
		);
		expect(three.status).toBe(200);
		expect(logText()).toMatch(
			/routes update \/\S*SetupShell\.vue \+\/alt\/three/
		);
		expect(logText()).not.toContain('No match found');
		expect(three.body).toBe((await fetchStatus(url('/alt/one'))).body);

		const fresh = await openPage(url('/alt/three'));
		try {
			await fresh.page.waitForSelector('.route-three', {
				timeout: 30_000
			});
			expect(await fresh.page.textContent('.shell-label')).toBe(
				'SETUP_SHELL'
			);
		} finally {
			await fresh.close();
		}
	}, 90_000);
});
