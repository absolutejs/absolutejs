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

/* Vue pages whose only script block is a plain `<script>` (no
 * `<script setup>`). compileScript emits no `export default` for a plain
 * script that has none (the README's defineRoutes SPA shell), and the
 * compilers then referenced a component object that was never declared:
 * every route answered 500 "ReferenceError: script is not defined" in
 * production and "__script__ is not defined" in dev.
 *
 * Each page must answer 200 and mount in a browser, in production and in
 * dev:
 *   - the README sample verbatim: `export const routes = defineRoutes(...)`
 *     with `<template><RouterView /></template>` and no import — app.use
 *     (router) registers RouterView / RouterLink globally;
 *   - a plain `export default defineComponent({...})` page with state;
 *   - a plain script with only a named export and no default. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'dist', 'cli', 'index.js');
const BUILD_DIR = 'start-build';

const FILES: Record<string, string> = {
	'absolute.config.ts': `import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	buildDirectory: './build',
	vueDirectory: './src/frontend/vue'
});
`,
	'package.json': `{ "name": "vue-plain-script-app", "private": true, "type": "module" }
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
	.get('/app', ({ request }) => page('RoutedShell', request))
	.get('/app/*', ({ request }) => page('RoutedShell', request))
	.get('/plain', ({ request }) => page('PlainCounter', request))
	.get('/static', ({ request }) => page('NamedOnly', request))
	.use(networking);
`,
	'src/frontend/vue/components/RouteOne.vue': `<template>
	<section class="route-one">
		ROUTE_ONE
		<RouterLink class="to-two" to="/app/two">Two</RouterLink>
	</section>
</template>
`,
	'src/frontend/vue/components/RouteTwo.vue': `<script setup lang="ts">
import { useRoute } from 'vue-router';

const route = useRoute();
</script>

<template>
	<section class="route-two">ROUTE_TWO {{ route.path }}</section>
</template>
`,
	'src/frontend/vue/pages/NamedOnly.vue': `<script lang="ts">
export const pageLabel = 'NAMED_ONLY';
</script>

<template>
	<main class="named-only">NAMED_ONLY_PAGE</main>
</template>
`,
	'src/frontend/vue/pages/PlainCounter.vue': `<script lang="ts">
import { defineComponent, ref } from 'vue';

export default defineComponent({
	setup() {
		const count = ref(0);

		return { count };
	}
});
</script>

<template>
	<main>
		<button class="plain-counter" type="button" @click="count++">PLAIN {{ count }}</button>
	</main>
</template>
`,
	'src/frontend/vue/pages/RoutedShell.vue': `<script lang="ts">
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

type Mode = 'dev' | 'production';

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

const waitForServer = async (app: RunningApp) => {
	for (let attempt = 0; attempt < 480; attempt++) {
		if (app.server.exitCode !== null)
			throw new Error(
				`server exited with ${app.server.exitCode}: ${app.log.join('')}`
			);
		try {
			const response = await fetch(`${app.baseUrl}/static`);
			if (response.ok) return;
		} catch {
			// not listening yet
		}
		await Bun.sleep(250);
	}
	throw new Error(`server did not start: ${app.log.join('')}`);
};

const startApp = async (mode: Mode) => {
	const root = await mkdtemp(join(tmpdir(), `absolute-vue-plain-${mode}-`));
	await Promise.all(
		Object.entries(FILES).map(async ([path, contents]) => {
			await mkdir(dirname(join(root, path)), { recursive: true });
			await writeFile(join(root, path), contents);
		})
	);
	await linkNodeModules(root);
	const port = await getAvailablePort();
	const command =
		mode === 'dev'
			? ['bun', CLI_ENTRY, 'dev', 'server.ts']
			: ['bun', CLI_ENTRY, 'start', 'server.ts', '--outdir', BUILD_DIR];
	const server = Bun.spawn(command, {
		cwd: root,
		env: {
			...process.env,
			FORCE_COLOR: '0',
			NODE_ENV: mode === 'dev' ? 'development' : 'production',
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
	await waitForServer(app);

	return app;
};

const stopApp = async (app: RunningApp | undefined) => {
	if (!app) return;
	app.server.kill();
	await app.server.exited;
	await rm(app.root, { force: true, recursive: true });
};

const describeMode = (mode: Mode) => {
	let app: RunningApp | undefined;
	const appUrl = (path: string) => `${app?.baseUrl ?? ''}${path}`;

	beforeAll(async () => {
		await ensureDistBuild();
		app = await startApp(mode);
	}, 600_000);

	afterAll(async () => {
		await stopApp(app);
	});

	test('every page answers 200', async () => {
		const expectations: [string, string | undefined][] = [
			['/app/one', undefined],
			['/app/two', undefined],
			['/plain', 'PLAIN 0'],
			['/static', 'NAMED_ONLY_PAGE']
		];
		for (const [path, text] of expectations) {
			const response = await fetch(appUrl(path));
			const html = await response.text();
			expect({ path, status: response.status }).toEqual({
				path,
				status: 200
			});
			expect(html).not.toContain('is not defined');
			if (text) expect(html).toContain(text);
		}
	});

	test('the defineRoutes shell mounts each route and navigates', async () => {
		const errors: string[] = [];
		const session = await openPage(appUrl('/app/one'), {
			consoleLog: (message) => {
				if (/error|warn/i.test(message)) errors.push(message);
			}
		});
		try {
			const { page } = session;
			page.on('pageerror', (error) => errors.push(error.message));
			await page.waitForSelector('.route-one', { timeout: 30_000 });
			expect(await page.textContent('.route-one')).toContain('ROUTE_ONE');
			await page.click('.to-two');
			await page.waitForSelector('.route-two', { timeout: 30_000 });
			expect(await page.textContent('.route-two')).toBe(
				'ROUTE_TWO /app/two'
			);
			await page.goto(appUrl('/app/two'));
			await page.waitForSelector('.route-two', { timeout: 30_000 });
			expect(await page.textContent('.route-two')).toBe(
				'ROUTE_TWO /app/two'
			);
			expect(errors).toEqual([]);
		} finally {
			await session.close();
		}
	}, 90_000);

	test('a plain-script defineComponent page hydrates', async () => {
		const errors: string[] = [];
		const session = await openPage(appUrl('/plain'), {
			consoleLog: (message) => {
				if (/error|warn|mismatch/i.test(message)) errors.push(message);
			}
		});
		try {
			const { page } = session;
			page.on('pageerror', (error) => errors.push(error.message));
			await page.waitForSelector('.plain-counter', { timeout: 30_000 });
			await page.waitForFunction(
				() => {
					const button = document.querySelector('.plain-counter');
					button?.dispatchEvent(new MouseEvent('click'));

					return button?.textContent !== 'PLAIN 0';
				},
				undefined,
				{ polling: 250, timeout: 30_000 }
			);
			expect(await page.textContent('.plain-counter')).not.toBe(
				'PLAIN 0'
			);
			expect(errors).toEqual([]);
		} finally {
			await session.close();
		}
	}, 90_000);
};

describe('production: Vue pages with only a plain <script>', () => {
	describeMode('production');
});

describe('dev: Vue pages with only a plain <script>', () => {
	describeMode('dev');
});
