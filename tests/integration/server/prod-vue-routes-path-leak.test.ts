import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
	mkdir,
	mkdtemp,
	readdir,
	realpath,
	rm,
	symlink,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { openPage } from '../../helpers/browser';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';
import { getAvailablePort } from '../../helpers/ports';

/* Production smoke test: Vue pages that export `routes` must not ship the
 * build machine's paths. compileVue mirrored every source file under
 * `sources/<encoded filesystem root>/<absolute path>`, so a lazily loaded
 * route component was served (and imported by the router index and a shared
 * chunk) as `.absolutejs/generated/vue/client/sources/%2F/private/tmp/…/
 * VrLazy.<hash>.js` — the project's absolute root, in every browser. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'dist', 'cli', 'index.js');
const BUILD_DIR = 'start-build';
const SERVED_EXTENSIONS = /\.(?:js|css|html)$/;

const FILES: Record<string, string> = {
	'absolute.config.ts': `import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	buildDirectory: './build',
	vueDirectory: './src/frontend/vue'
});
`,
	'server.ts': `import { Elysia } from 'elysia';
import { asset, networking, prepare } from '@absolutejs/absolute';
import { handleVuePageRequest } from '@absolutejs/absolute/vue';

const { absolutejs, manifest } = await prepare();

const routerPage = (request: Request) =>
	handleVuePageRequest({
		indexPath: asset(manifest, 'VueRouterIndex'),
		pagePath: asset(manifest, 'VueRouter'),
		props: {},
		request
	});

export const server = new Elysia()
	.use(absolutejs)
	.get('/vr', ({ request }) => routerPage(request))
	.get('/vr/*', ({ request }) => routerPage(request))
	.use(networking);
`,
	'src/frontend/vue/components/VrHome.vue': `<template>
	<section class="vr-home">VR_HOME</section>
</template>
`,
	'src/frontend/vue/components/VrLazy.vue': `<script setup lang="ts">
import { useRoute } from 'vue-router';
import { shout } from '../utils/shout';

const route = useRoute();
</script>

<template>
	<section class="vr-lazy">{{ shout(String(route.params.slug)) }}</section>
</template>

<style scoped>
.vr-lazy { color: rgb(20, 120, 60); }
</style>
`,
	'src/frontend/vue/pages/VueRouter.vue': `<script lang="ts">
import { defineRoutes } from '@absolutejs/absolute/vue';

export const routes = defineRoutes([
	{
		component: () => import('../components/VrHome.vue').then((mod) => mod.default),
		path: '/vr'
	},
	{
		component: () => import('../components/VrLazy.vue').then((mod) => mod.default),
		path: '/vr/lazy/:slug'
	}
]);
</script>

<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router';
</script>

<template>
	<main class="vr-shell">
		<h1>VR_SHELL</h1>
		<RouterLink class="to-lazy" to="/vr/lazy/client">Lazy</RouterLink>
		<RouterView />
	</main>
</template>
`,
	'src/frontend/vue/utils/shout.ts': `export const shout = (text: string) => \`LAZY_\${text.toUpperCase()}\`;
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

const listFiles = async (directory: string): Promise<string[]> => {
	const entries = await readdir(directory, { withFileTypes: true });
	const nested = await Promise.all(
		entries.map((entry) => {
			const path = join(directory, entry.name);

			return entry.isDirectory()
				? listFiles(path)
				: Promise.resolve([path]);
		})
	);

	return nested.flat();
};

let root = '';
let rootAliases: string[] = [];
let baseUrl = '';
let server: ReturnType<typeof Bun.spawn> | undefined;

const waitForServer = async () => {
	for (let attempt = 0; attempt < 480; attempt++) {
		if (server?.exitCode !== null && server?.exitCode !== undefined)
			throw new Error(`absolute start exited with ${server.exitCode}`);
		try {
			await fetch(`${baseUrl}/vr`);

			return;
		} catch {
			await Bun.sleep(250);
		}
	}
	throw new Error('production server did not start');
};

const leakedRoots = (text: string) =>
	rootAliases.filter((alias) => text.includes(alias));

beforeAll(async () => {
	await ensureDistBuild();
	root = await mkdtemp(join(tmpdir(), 'absolute-prod-vue-path-leak-'));
	// macOS tmpdir sits behind the /var → /private/var symlink; the build
	// sees the resolved path. Check every spelling, with either separator.
	const resolvedRoot = await realpath(root);
	rootAliases = Array.from(
		new Set(
			[root, resolvedRoot].flatMap((path) => [
				path,
				path.replace(/\\/g, '/')
			])
		)
	);
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
		['bun', CLI_ENTRY, 'start', 'server.ts', '--outdir', BUILD_DIR],
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

describe('production smoke: Vue routes do not leak the project path', () => {
	test('no served JS, CSS or HTML file contains the project root', async () => {
		const buildRoot = join(root, BUILD_DIR);
		const files = (await listFiles(buildRoot))
			.map((path) => relative(buildRoot, path).split(sep).join('/'))
			.filter((path) => SERVED_EXTENSIONS.test(path));
		// The lazy route component is its own client chunk, mirrored by its
		// project-relative path.
		expect(
			files.some((path) =>
				/vue\/client\/sources\/src\/frontend\/vue\/components\/VrLazy\.[^/]+\.js$/.test(
					path
				)
			)
		).toBe(true);
		expect(files.filter((path) => path.includes('%2F'))).toEqual([]);

		const served = await Promise.all(
			files.map(async (path) => {
				const response = await fetch(`${baseUrl}/${path}`);

				return {
					body: await response.text(),
					path,
					status: response.status
				};
			})
		);
		const clientFiles = served.filter(({ status }) => status === 200);
		expect(clientFiles.some(({ path }) => path.includes('VrLazy.'))).toBe(
			true
		);
		expect(
			clientFiles.some(({ path }) =>
				/vue\/indexes\/VueRouter\.[^/]+\.js$/.test(path)
			)
		).toBe(true);
		const leaks = clientFiles
			.map(({ body, path }) => ({ path, roots: leakedRoots(body) }))
			.filter(({ roots }) => roots.length > 0);
		expect(leaks).toEqual([]);

		for (const pathname of ['/vr', '/vr/lazy/direct']) {
			const response = await fetch(`${baseUrl}${pathname}`);
			const html = await response.text();
			expect(response.status).toBe(200);
			expect(leakedRoots(html)).toEqual([]);
		}
	});

	test('a direct visit to a nested lazy route mounts it', async () => {
		const errors: string[] = [];
		const failed: string[] = [];
		const session = await openPage(`${baseUrl}/vr/lazy/direct`);
		try {
			const { page } = session;
			page.on('pageerror', (error) => errors.push(error.message));
			page.on('response', (response) => {
				if (response.status() >= 400)
					failed.push(`${response.status()} ${response.url()}`);
			});
			await page.waitForSelector('.vr-lazy', { timeout: 20_000 });
			expect(await page.textContent('.vr-lazy')).toBe('LAZY_DIRECT');
			// Client-side navigation reuses the same lazy chunk.
			await page.goto(`${baseUrl}/vr`);
			await page.waitForSelector('.vr-home', { timeout: 20_000 });
			await page.click('.to-lazy');
			await page.waitForSelector('.vr-lazy', { timeout: 20_000 });
			expect(await page.textContent('.vr-lazy')).toBe('LAZY_CLIENT');
			expect(errors).toEqual([]);
			expect(failed).toEqual([]);
		} finally {
			await session.close();
		}
	}, 60_000);
});
