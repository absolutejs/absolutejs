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

/* An island that imports a shared module by a relative path that leaves
 * the islands directory (`../shared/counterStore`), and through a nested
 * helper (`./lib/label` -> `../../shared/counterStore`), next to an import of
 * the directory itself (`../shared`), a prefix of the other specifier. The island's server
 * render is compiled into `.absolutejs/islands/<framework>/...`, and the
 * relative specifier was left as written, so it resolved against that
 * generated file and the render failed with "Cannot find module
 * '../shared/counterStore'". Both islands must render on the server with
 * the store's values and hydrate in the browser, in production and in
 * dev, on static HTML, Svelte and Vue host pages. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'dist', 'cli', 'index.js');

const islandMarkup = `<absolute-island framework="vue" component="VueCounter" props='{"start":2}'></absolute-island>
		<absolute-island framework="svelte" component="SvelteCounter" props='{"start":5}'></absolute-island>`;

const FILES: Record<string, string> = {
	'absolute.config.ts': `import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	buildDirectory: 'build',
	htmlDirectory: 'src/frontend/html',
	islands: { registry: 'src/islands/registry.ts' },
	svelteDirectory: 'src/frontend/svelte',
	vueDirectory: 'src/frontend/vue'
});
`,
	'package.json': `{ "name": "island-relative-imports-app", "private": true, "type": "module" }
`,
	'src/backend/server.ts': `import { Elysia } from 'elysia';
import { asset, handleHTMLPageRequest, networking, prepare } from '@absolutejs/absolute';
import { handleSveltePageRequest } from '@absolutejs/absolute/svelte';
import { handleVuePageRequest } from '@absolutejs/absolute/vue';

const { absolutejs, manifest } = await prepare();

export const server = new Elysia()
	.use(absolutejs)
	.get('/html', () => handleHTMLPageRequest(asset(manifest, 'HtmlIslands')))
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
	.use(networking);
`,
	'src/frontend/html/pages/HtmlIslands.html': `<!doctype html>
<html>
	<head>
		<meta charset="utf-8" />
		<title>HTML_ISLANDS</title>
	</head>
	<body>
		<h1>HTML_ISLANDS</h1>
		${islandMarkup}
	</body>
</html>
`,
	'src/frontend/svelte/pages/SvelteIslands.svelte': `<h1>SVELTE_ISLANDS</h1>
<Island framework="vue" component="VueCounter" props={{ start: 2 }} />
<Island framework="svelte" component="SvelteCounter" props={{ start: 5 }} />
`,
	'src/frontend/vue/pages/VueIslands.vue': `<script setup lang="ts">
import { Island } from '@absolutejs/absolute/vue';
</script>

<template>
	<main>
		<h1>VUE_ISLANDS</h1>
		<Island framework="vue" component="VueCounter" :props="{ start: 2 }" />
		<Island framework="svelte" component="SvelteCounter" :props="{ start: 5 }" />
	</main>
</template>
`,
	'src/islands/lib/label.ts': `import { counterStore } from '../../shared/counterStore';

export const islandLabel = (name: string) => \`\${name}:\${counterStore.label}\`;
`,
	'src/islands/registry.ts': `import { defineIslandRegistry } from '@absolutejs/absolute/islands';
import SvelteCounter from './SvelteCounter.svelte';
import VueCounter from './VueCounter.vue';

export const islandRegistry = defineIslandRegistry({
	svelte: { SvelteCounter },
	vue: { VueCounter }
});
`,
	'src/islands/SvelteCounter.svelte': `<script lang="ts">
	import { SHARED_TAG } from '../shared';
	import { counterStore } from '../shared/counterStore';
	import { islandLabel } from './lib/label';

	let { start }: { start: number } = $props();
	let count = $state(counterStore.base + start);
</script>

<button class="svelte-island" onclick={() => (count += 1)} type="button">{islandLabel('SVELTE')} {counterStore.format(count)} {SHARED_TAG}</button>
`,
	'src/islands/VueCounter.vue': `<script setup lang="ts">
import { ref } from 'vue';
import { SHARED_TAG } from '../shared';
import { counterStore } from '../shared/counterStore';
import { islandLabel } from './lib/label';

const props = defineProps<{ start: number }>();
const count = ref(counterStore.base + props.start);
</script>

<template>
	<button class="vue-island" type="button" @click="count++">{{ islandLabel('VUE') }} {{ counterStore.format(count) }} {{ SHARED_TAG }}</button>
</template>
`,
	'src/shared/counterStore.ts': `import { formatCount } from './format';

export const counterStore = {
	base: 40,
	format: formatCount,
	label: 'STORE'
};
`,
	'src/shared/format.ts': `export const formatCount = (count: number) => \`COUNT_\${count}\`;
`,
	'src/shared/index.ts': `export { counterStore } from './counterStore';
export const SHARED_TAG = 'TAG';
`,
	'tsconfig.json': `{
	"compilerOptions": {
		"module": "esnext",
		"moduleResolution": "bundler",
		"skipLibCheck": true,
		"strict": true,
		"target": "esnext"
	}
}
`
};

const HOST_ROUTES = ['/html', '/svelte', '/vue'];

const VUE_TEXT = (count: number) => `VUE:STORE COUNT_${count} TAG`;
const SVELTE_TEXT = (count: number) => `SVELTE:STORE COUNT_${count} TAG`;

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

type RunningApp = {
	baseUrl: string;
	output: () => string;
	root: string;
	server: ReturnType<typeof Bun.spawn>;
};

const drain = async (stream: ReadableStream<Uint8Array>, sink: string[]) => {
	const decoder = new TextDecoder();
	for await (const chunk of stream) sink.push(decoder.decode(chunk));
};

const startApp = async (prefix: string, args: string[], nodeEnv: string) => {
	const root = await mkdtemp(join(tmpdir(), prefix));
	await Promise.all(
		Object.entries(FILES).map(async ([path, contents]) => {
			await mkdir(dirname(join(root, path)), { recursive: true });
			await writeFile(join(root, path), contents);
		})
	);
	await linkNodeModules(root);
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
		stderr: 'pipe',
		stdout: 'pipe'
	});
	const logs: string[] = [];
	void drain(server.stdout, logs);
	void drain(server.stderr, logs);
	const app: RunningApp = {
		baseUrl,
		root,
		server,
		output: () => logs.join('')
	};
	for (let attempt = 0; attempt < 480; attempt++) {
		if (server.exitCode !== null)
			throw new Error(
				`absolute ${args[0]} exited with ${server.exitCode}\n${app.output()}`
			);
		try {
			const response = await fetch(`${baseUrl}/html`);
			if (response.ok) return app;
		} catch {
			// not listening yet
		}
		await Bun.sleep(250);
	}
	throw new Error(`absolute ${args[0]} did not start\n${app.output()}`);
};

const stopApp = async (app: RunningApp | undefined) => {
	if (!app) return;
	app.server.kill();
	await app.server.exited;
	await rm(app.root, { force: true, recursive: true });
};

const expectServerRender = async (app: RunningApp) => {
	for (const path of HOST_ROUTES) {
		const response = await fetch(`${app.baseUrl}${path}`);
		const html = await response.text();

		expect(`${path} ${response.status}`).toBe(`${path} 200`);
		expect(html).toContain(VUE_TEXT(42));
		expect(html).toContain(SVELTE_TEXT(45));
	}
	expect(app.output()).not.toContain('Cannot find module');
};

const expectHydration = async (app: RunningApp) => {
	for (const path of HOST_ROUTES) {
		const errors: string[] = [];
		const session = await openPage(`${app.baseUrl}${path}`);
		const { page } = session;
		page.on('pageerror', (error) => errors.push(error.message));
		try {
			await page.waitForFunction(
				() => {
					const islands = Array.from(
						document.querySelectorAll('[data-island="true"]')
					);

					return (
						islands.length === 2 &&
						islands.every(
							(element) =>
								element.getAttribute('data-hydrated') === 'true'
						)
					);
				},
				undefined,
				{ timeout: 30_000 }
			);
			await page.click('.vue-island');
			await page.click('.svelte-island');
			await page.waitForFunction(
				([vue, svelte]) =>
					document.querySelector('.vue-island')?.textContent ===
						vue &&
					document.querySelector('.svelte-island')?.textContent ===
						svelte,
				[VUE_TEXT(43), SVELTE_TEXT(46)],
				{ timeout: 10_000 }
			);
			expect({ errors, path }).toEqual({ errors: [], path });
		} finally {
			await session.close();
		}
	}
};

describe('islands with relative imports outside the islands directory in production', () => {
	let app: RunningApp | undefined;

	beforeAll(async () => {
		await ensureDistBuild();
		app = await startApp(
			'absolute-island-relative-prod-',
			['start', 'src/backend/server.ts', '--outdir', 'start-build'],
			'production'
		);
	}, 600_000);

	afterAll(() => stopApp(app));

	test('Vue and Svelte islands render the shared store on the server', async () => {
		if (!app) throw new Error('app did not start');
		await expectServerRender(app);
	}, 60_000);

	test('Vue and Svelte islands hydrate', async () => {
		if (!app) throw new Error('app did not start');
		await expectHydration(app);
	}, 120_000);
});

describe('islands with relative imports outside the islands directory in dev', () => {
	let app: RunningApp | undefined;

	beforeAll(async () => {
		await ensureDistBuild();
		app = await startApp(
			'absolute-island-relative-dev-',
			['dev'],
			'development'
		);
	}, 600_000);

	afterAll(() => stopApp(app));

	test('Vue and Svelte islands render the shared store on the server', async () => {
		if (!app) throw new Error('app did not start');
		await expectServerRender(app);
	}, 60_000);

	test('Vue and Svelte islands hydrate', async () => {
		if (!app) throw new Error('app did not start');
		await expectHydration(app);
	}, 120_000);
});
