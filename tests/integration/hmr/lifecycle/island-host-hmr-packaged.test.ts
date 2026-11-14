import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
	cp,
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
import { openPage, type BrowserSession } from '../../../helpers/browser';
import { ensureDistBuild } from '../../../helpers/ensureDistBuild';
import { getAvailablePort } from '../../../helpers/ports';

/* A React page with islands (React, Svelte and Vue) in `absolute dev`, in
 * a project shaped like a create-absolutejs scaffold and running the
 * PACKAGED framework: the package is installed as a real directory
 * (package.json + dist/) inside the project's node_modules, the way
 * `bun install` lays it out, not as a symlink to this checkout.
 *
 * The islands bootstrap (one prebuilt file in <head>) imports React DOM,
 * and on a real app it runs before the page's own script, whose module
 * graph the dev server transpiles on request. Two things broke when it did:
 * - React DOM loaded before the page installed Fast Refresh and never
 *   registered with it, so every edit to the page or a component it
 *   imports logged "react component … applied" and changed nothing;
 * - the first island root claimed the document's React event listening
 *   marker, so the page root, created on the document afterwards, got no
 *   event listeners and nothing outside the islands handled a click.
 * Island edits also re-mounted the island, resetting its state, where the
 * framework's own HMR keeps it. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..', '..');
const VISIBLE_WITHIN_MS = 2_000;

const FILES: Record<string, string> = {
	'absolute.config.ts': `import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	assetsDirectory: 'src/backend/assets',
	buildDirectory: 'build',
	islands: { registry: 'src/islands/registry.ts' },
	publicDirectory: 'public',
	reactDirectory: 'src/frontend/react',
	svelteDirectory: 'src/frontend/svelte',
	vueDirectory: 'src/frontend/vue'
});
`,
	'package.json': `{
	"name": "island-host-packaged-app",
	"private": true,
	"scripts": { "dev": "absolute dev" },
	"type": "module"
}
`,
	'public/.gitkeep': '',
	'src/backend/assets/.gitkeep': '',
	'src/backend/server.ts': `import { IslandsPage } from '../frontend/react/pages/IslandsPage';
import { asset, networking, prepare, secureHeaders } from '@absolutejs/absolute';
import { handleReactPageRequest } from '@absolutejs/absolute/react';
import { Elysia } from 'elysia';

const { absolutejs, manifest } = await prepare();

const server = new Elysia()
	.use(secureHeaders())
	.use(absolutejs)
	.get('/islands', () =>
		handleReactPageRequest({
			Page: IslandsPage,
			index: asset(manifest, 'IslandsPageIndex'),
			props: { initialCount: 0 }
		})
	)
	.use(networking);

export type Server = typeof server;
`,
	'src/frontend/react/components/App.tsx': `import { useState } from 'react';

type AppProps = { initialCount: number };

export const App = ({ initialCount }: AppProps) => {
	const [count, setCount] = useState(initialCount);

	return (
		<main>
			<p className="label">LABEL_0</p>
			<button className="host-counter" onClick={() => setCount(count + 1)} type="button">
				count is {count}
			</button>
		</main>
	);
};
`,
	'src/frontend/react/components/Head.tsx': `export const Head = ({ title = 'Islands' }: { title?: string }) => (
	<head>
		<meta charSet="utf-8" />
		<title>{title}</title>
		<meta name="viewport" content="width=device-width, initial-scale=1" />
	</head>
);
`,
	'src/frontend/react/pages/IslandsPage.tsx': `import { Island } from '@absolutejs/absolute/react';
import { App } from '../components/App';
import { Head } from '../components/Head';

type IslandsPageProps = { initialCount: number };

export const IslandsPage = ({ initialCount }: IslandsPageProps) => (
	<html>
		<Head />
		<body>
			<h1 className="heading">HOST_0</h1>
			<App initialCount={initialCount} />
			<Island component="ReactCounter" framework="react" props={{ start: 3 }} />
			<Island component="SvelteCounter" framework="svelte" props={{ start: 5 }} />
			<Island component="VueCounter" framework="vue" props={{ start: 7 }} />
		</body>
	</html>
);
`,
	'src/frontend/svelte/pages/SvelteHome.svelte': `<h1>SVELTE_HOME</h1>
`,
	'src/frontend/vue/pages/VueHome.vue': `<template><h1>VUE_HOME</h1></template>
`,
	'src/islands/ReactCounter.tsx': `import { useState } from 'react';

export const ReactCounter = ({ start }: { start: number }) => {
	const [count, setCount] = useState(start);

	return (
		<button className="react-island" onClick={() => setCount(count + 1)} type="button">
			REACT_ISLAND {count}
		</button>
	);
};
`,
	'src/islands/registry.ts': `import { defineIslandRegistry } from '@absolutejs/absolute/islands';
import { ReactCounter } from './ReactCounter';
import SvelteCounter from './SvelteCounter.svelte';
import VueCounter from './VueCounter.vue';

export const islandRegistry = defineIslandRegistry({
	react: { ReactCounter },
	svelte: { SvelteCounter },
	vue: { VueCounter }
});
`,
	'src/islands/SvelteCounter.svelte': `<script lang="ts">
	let { start }: { start: number } = $props();
	let count = $state(start);
</script>

<button class="svelte-island" onclick={() => (count += 1)} type="button">SVELTE_ISLAND {count}</button>
`,
	'src/islands/VueCounter.vue': `<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{ start: number }>();
const count = ref(props.start);
</script>

<template>
	<button class="vue-island" type="button" @click="count++">VUE_ISLAND {{ count }}</button>
</template>
`,
	'tsconfig.json': `{
	"compilerOptions": {
		"esModuleInterop": true,
		"jsx": "react-jsx",
		"module": "ESNext",
		"moduleResolution": "bundler",
		"noUncheckedIndexedAccess": true,
		"skipLibCheck": true,
		"strict": true,
		"target": "ESNext"
	}
}
`
};

/* Every dependency comes from the repo's node_modules (symlinked), but
 * @absolutejs/absolute is installed as a copy of the package's published
 * files, so the framework runs from <project>/node_modules like an
 * npm-installed copy does. */
const installPackagedFramework = async (projectRoot: string) => {
	const source = join(repoRoot, 'node_modules');
	const target = join(projectRoot, 'node_modules');
	await mkdir(join(target, '@absolutejs'), { recursive: true });
	await mkdir(join(target, '.bin'), { recursive: true });
	const [entries, scoped] = await Promise.all([
		readdir(source),
		readdir(join(source, '@absolutejs'))
	]);
	const installed = join(target, '@absolutejs', 'absolute');
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
		cp(join(repoRoot, 'dist'), join(installed, 'dist'), {
			recursive: true
		}),
		cp(join(repoRoot, 'package.json'), join(installed, 'package.json'))
	]);
	await symlink(
		'../@absolutejs/absolute/dist/cli/index.js',
		join(target, '.bin', 'absolute')
	);
};

let root = '';
let baseUrl = '';
let port = 0;
let server: ReturnType<typeof Bun.spawn> | undefined;
const serverLog: string[] = [];

const collectOutput = async (stream: ReadableStream<Uint8Array>) => {
	const decoder = new TextDecoder();
	for await (const chunk of stream) serverLog.push(decoder.decode(chunk));
};

const waitForServer = async () => {
	for (let attempt = 0; attempt < 480; attempt++) {
		if (server?.exitCode !== null && server?.exitCode !== undefined)
			throw new Error(
				`absolute dev exited with ${server.exitCode}: ${serverLog.join('')}`
			);
		try {
			const response = await fetch(`${baseUrl}/islands`);
			if (response.ok) return;
		} catch {
			// not listening yet
		}
		await Bun.sleep(250);
	}
	throw new Error(`dev server did not start: ${serverLog.join('')}`);
};

const startServer = async () => {
	serverLog.length = 0;
	server = Bun.spawn(['bun', 'run', 'dev'], {
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
	void collectOutput(server.stdout as ReadableStream<Uint8Array>);
	void collectOutput(server.stderr as ReadableStream<Uint8Array>);
	await waitForServer();
};

const stopServer = async () => {
	server?.kill();
	await server?.exited;
	server = undefined;
};

const editFile = async (path: string, from: string, to: string) => {
	const filePath = join(root, path);
	const source = await readFile(filePath, 'utf-8');
	if (!source.includes(from)) throw new Error(`${from} not in ${path}`);
	await writeFile(filePath, source.replace(from, to));
};

const textOf = (page: Page, selector: string) =>
	page.evaluate(
		(target) => document.querySelector(target)?.textContent ?? null,
		selector
	);

const waitForText = (
	page: Page,
	selector: string,
	text: string,
	timeout = 30_000
) =>
	page.waitForFunction(
		([target, expected]) =>
			document.querySelector(target ?? '')?.textContent === expected,
		[selector, text],
		{ timeout }
	);

type Watched = { messages: string[]; session: BrowserSession };

/* How long each of the page's own modules (/@src/…) takes to arrive. A
 * real app's page imports many components the dev server transpiles on
 * request, so its module graph finishes loading after the islands
 * bootstrap (one prebuilt file and the React vendor). That ordering is what
 * broke host-page Fast Refresh, so every test here loads the page that way
 * instead of depending on how fast this machine transpiles. */
const PAGE_MODULE_DELAY_MS = 300;

const openWatched = async (): Promise<Watched> => {
	const messages: string[] = [];
	const session = await openPage(`${baseUrl}/islands`, {
		consoleLog: (message) => messages.push(message)
	});
	const { page } = session;
	page.on('pageerror', (error) => messages.push(error.message));
	await page.route(/\/@src\//, async (route) => {
		await Bun.sleep(PAGE_MODULE_DELAY_MS);
		await route.continue();
	});
	await page.reload({ waitUntil: 'load' });
	await page.waitForSelector('.heading');
	for (const component of ['ReactCounter', 'SvelteCounter', 'VueCounter'])
		await page.waitForSelector(
			`[data-island="true"][data-component="${component}"][data-hydrated="true"]`,
			{ timeout: 30_000 }
		);
	// The page's own root exists too.
	await page.waitForFunction(() =>
		Object.keys(document).some((key) => key.startsWith('__reactContainer$'))
	);
	await page.evaluate(() => Reflect.set(window, '__noReload', true));
	// Edits re-import page modules: deliver those at full speed.
	await page.unrouteAll({ behavior: 'ignoreErrors' });

	return { messages, session };
};

/* Replace `<prefix>_<n>` with `<prefix>_<n + 1>` in `file` and require the
 * new text on screen within VISIBLE_WITHIN_MS, without a reload. */
const expectEditVisible = async (
	watched: Watched,
	file: string,
	selector: string,
	prefix: string
) => {
	const { page } = watched.session;
	const current = (await textOf(page, selector)) ?? '';
	const edit = Number(current.slice(prefix.length + 1));
	const next = `${prefix}_${edit + 1}`;
	const logStart = serverLog.length;
	await editFile(file, `${prefix}_${edit}`, next);
	try {
		await waitForText(page, selector, next, VISIBLE_WITHIN_MS);
	} catch {
		// Let the server finish logging before reporting.
		await Bun.sleep(1_000);
		throw new Error(
			`${file}: "${next}" never reached ${selector} (still ` +
				`"${await textOf(page, selector)}"); console: ` +
				`${watched.messages.join(' | ')}; server: ` +
				`${serverLog.slice(logStart).join('')}`
		);
	}
	expect(await page.evaluate(() => Reflect.get(window, '__noReload'))).toBe(
		true
	);
};

/* Click `selector` and require its count to go up by one. */
const clickAndCount = async (page: Page, selector: string) => {
	const before = (await textOf(page, selector)) ?? '';
	const count = Number(before.split(' ').pop());
	const expected = before.replace(/\d+$/, String(count + 1));
	await page.click(selector);
	try {
		await waitForText(page, selector, expected, 5_000);
	} catch {
		throw new Error(
			`clicking ${selector} left "${await textOf(page, selector)}", expected "${expected}"`
		);
	}
};

beforeAll(async () => {
	await ensureDistBuild();
	root = await mkdtemp(join(tmpdir(), 'absolute island host packaged '));
	await Promise.all(
		Object.entries(FILES).map(async ([path, contents]) => {
			await mkdir(dirname(join(root, path)), { recursive: true });
			await writeFile(join(root, path), contents);
		})
	);
	await installPackagedFramework(root);
	port = await getAvailablePort();
	baseUrl = `http://localhost:${port}`;
}, 600_000);

afterAll(async () => {
	await stopServer();
	if (root) await rm(root, { force: true, recursive: true });
});

describe('dev (packaged framework): a React page with islands', () => {
	test('the first host edit after a fresh boot reaches the page', async () => {
		await startServer();
		const watched = await openWatched();
		try {
			await expectEditVisible(
				watched,
				'src/frontend/react/pages/IslandsPage.tsx',
				'.heading',
				'HOST'
			);
		} finally {
			await watched.session.close();
		}
	}, 600_000);

	test('the page outside the islands handles events', async () => {
		const watched = await openWatched();
		const { page } = watched.session;
		try {
			await clickAndCount(page, '.host-counter');
			await clickAndCount(page, '.react-island');
			await clickAndCount(page, '.svelte-island');
			await clickAndCount(page, '.vue-island');
		} finally {
			await watched.session.close();
		}
	}, 120_000);

	test('repeated page and imported-component edits reach the page and keep state', async () => {
		const watched = await openWatched();
		const { page } = watched.session;
		try {
			await clickAndCount(page, '.host-counter');
			await clickAndCount(page, '.react-island');
			const hostCount = await textOf(page, '.host-counter');
			const islandCount = await textOf(page, '.react-island');
			for (let round = 0; round < 5; round++) {
				await expectEditVisible(
					watched,
					'src/frontend/react/pages/IslandsPage.tsx',
					'.heading',
					'HOST'
				);
				await expectEditVisible(
					watched,
					'src/frontend/react/components/App.tsx',
					'.label',
					'LABEL'
				);
			}
			expect(await textOf(page, '.host-counter')).toBe(hostCount);
			expect(await textOf(page, '.react-island')).toBe(islandCount);
		} finally {
			await watched.session.close();
		}
	}, 300_000);

	/* Edit an island and wait until `selector` reads `expected`, without a
	 * reload. */
	const editIsland = async (
		watched: Watched,
		file: string,
		from: string,
		to: string,
		selector: string,
		expected: string
	) => {
		const { page } = watched.session;
		const logStart = serverLog.length;
		await editFile(file, from, to);
		try {
			await waitForText(page, selector, expected, 10_000);
		} catch {
			throw new Error(
				`${file}: ${selector} reads "${await textOf(page, selector)}", ` +
					`expected "${expected}"; console: ${watched.messages.join(' | ')}; ` +
					`server: ${serverLog.slice(logStart).join('')}`
			);
		}
		expect(
			await page.evaluate(() => Reflect.get(window, '__noReload'))
		).toBe(true);
	};

	test('island edits keep island state where the framework HMR can', async () => {
		const watched = await openWatched();
		const { page } = watched.session;
		try {
			await clickAndCount(page, '.host-counter');
			await clickAndCount(page, '.react-island');
			await clickAndCount(page, '.svelte-island');
			await clickAndCount(page, '.vue-island');
			const host = await textOf(page, '.host-counter');
			expect([
				await textOf(page, '.react-island'),
				await textOf(page, '.svelte-island'),
				await textOf(page, '.vue-island')
			]).toEqual(['REACT_ISLAND 4', 'SVELTE_ISLAND 6', 'VUE_ISLAND 8']);

			// React: Fast Refresh keeps hook state while the hooks stay the
			// same, and resets it when they change.
			await editIsland(
				watched,
				'src/islands/ReactCounter.tsx',
				'REACT_ISLAND {count}',
				'REACT_EDITED {count}',
				'.react-island',
				'REACT_EDITED 4'
			);
			await clickAndCount(page, '.react-island');
			await editIsland(
				watched,
				'src/islands/ReactCounter.tsx',
				'const [count, setCount] = useState(start);',
				'const [count, setCount] = useState(start);\n\tconst [label] = useState("REACT_HOOKS");',
				'.react-island',
				'REACT_EDITED 3'
			);
			await editIsland(
				watched,
				'src/islands/ReactCounter.tsx',
				'REACT_EDITED {count}',
				'{label} {count}',
				'.react-island',
				'REACT_HOOKS 3'
			);

			// Vue: a template edit re-renders in place and keeps state; a
			// script edit reloads the component, which starts over.
			await editIsland(
				watched,
				'src/islands/VueCounter.vue',
				'VUE_ISLAND {{ count }}',
				'VUE_EDITED {{ count }}',
				'.vue-island',
				'VUE_EDITED 8'
			);
			await clickAndCount(page, '.vue-island');
			await editIsland(
				watched,
				'src/islands/VueCounter.vue',
				'const count = ref(props.start);',
				'const count = ref(props.start + 10);',
				'.vue-island',
				'VUE_EDITED 17'
			);

			// Svelte: its HMR recreates the swapped component, so the edited
			// island starts over.
			await editIsland(
				watched,
				'src/islands/SvelteCounter.svelte',
				'SVELTE_ISLAND {count}',
				'SVELTE_EDITED {count}',
				'.svelte-island',
				'SVELTE_EDITED 5'
			);

			// Every edit left the page and the other islands alone, and all
			// of them still respond.
			expect(await textOf(page, '.host-counter')).toBe(host);
			expect(await textOf(page, '.react-island')).toBe('REACT_HOOKS 3');
			expect(await textOf(page, '.vue-island')).toBe('VUE_EDITED 17');
			await clickAndCount(page, '.host-counter');
			await clickAndCount(page, '.react-island');
			await clickAndCount(page, '.svelte-island');
			await clickAndCount(page, '.vue-island');
		} finally {
			await watched.session.close();
		}
	}, 300_000);
});
