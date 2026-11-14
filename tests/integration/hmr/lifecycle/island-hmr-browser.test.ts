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
import { openPage, type BrowserSession } from '../../../helpers/browser';
import { ensureDistBuild } from '../../../helpers/ensureDistBuild';
import { getAvailablePort } from '../../../helpers/ports';

/* HMR on pages that render islands, in an app laid out like a
 * create-absolutejs project: frameworks under src/frontend, the island
 * registry and its components in src/islands (outside every framework
 * directory), and a space in the project path.
 *
 * - Editing a React island skipped the build: the batch was marked handled
 *   before any fast path ran, so /islands/react/ReactCounter.<hash>.js kept
 *   serving the old code and every reload showed a hydration mismatch.
 * - Island sources were matched by their extensionless import path
 *   (`./ReactCounter`), so no page was found to update.
 * - Svelte and Vue island server renders were compiled once and cached, so
 *   the edit never reached the server render either.
 * - A host page re-render (an edit to the page, Fast Refresh) handed React a
 *   new `dangerouslySetInnerHTML` object for each island marker; React 19
 *   rewrote the marker's innerHTML and left a dead copy of the island.
 *
 * Each edit must show without a reload, keep the other islands' state, and
 * leave no hydration warning on the next reload. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'dist', 'cli', 'index.js');

const FILES: Record<string, string> = {
	'absolute.config.ts': `import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	buildDirectory: 'build',
	htmlDirectory: 'src/frontend/html',
	islands: { registry: 'src/islands/registry.ts' },
	reactDirectory: 'src/frontend/react',
	svelteDirectory: 'src/frontend/svelte',
	vueDirectory: 'src/frontend/vue'
});
`,
	'package.json': `{ "name": "island-hmr-app", "private": true, "type": "module" }
`,
	'src/backend/server.ts': `import { Elysia } from 'elysia';
import {
	asset,
	handleHTMLPageRequest,
	networking,
	prepare
} from '@absolutejs/absolute';
import { handleReactPageRequest } from '@absolutejs/absolute/react';
import { IslandsPage } from '../frontend/react/pages/IslandsPage';

const { absolutejs, manifest } = await prepare();

export const server = new Elysia()
	.use(absolutejs)
	.get('/islands', () =>
		handleReactPageRequest({
			index: asset(manifest, 'IslandsPageIndex'),
			Page: IslandsPage,
			props: {}
		})
	)
	.get('/html', () => handleHTMLPageRequest(asset(manifest, 'HtmlIslands')))
	.use(networking);
`,
	'src/frontend/html/pages/HtmlIslands.html': `<!doctype html>
<html>
	<head>
		<meta charset="utf-8" />
		<title>HTML islands</title>
	</head>
	<body>
		<h1>HTML_ISLANDS</h1>
		<absolute-island framework="react" component="ReactCounter" props='{"start":1}'></absolute-island>
	</body>
</html>
`,
	'src/frontend/react/components/Label.tsx': `export const Label = () => <p className="label">LABEL_TEXT</p>;
`,
	'src/frontend/react/pages/IslandsPage.tsx': `import { Island } from '@absolutejs/absolute/react';
import { Label } from '../components/Label';

export const IslandsPage = () => (
	<html>
		<head>
			<meta charSet="utf-8" />
			<title>Islands</title>
		</head>
		<body>
			<h1 className="heading">ISLANDS_PAGE</h1>
			<Label />
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
			throw new Error(`absolute dev exited with ${server.exitCode}`);
		try {
			const response = await fetch(`${baseUrl}/islands`);
			if (response.ok) return;
		} catch {
			// not listening yet
		}
		await Bun.sleep(250);
	}
	throw new Error('dev server did not start');
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

const waitForText = (page: Page, selector: string, text: string) =>
	page.waitForFunction(
		([target, expected]) =>
			document.querySelector(target ?? '')?.textContent === expected,
		[selector, text],
		{ timeout: 30_000 }
	);

type Watched = {
	messages: string[];
	session: BrowserSession;
};

const isHydrationWarning = (message: string) => /hydrat/i.test(message);

const openWatched = async (path: string): Promise<Watched> => {
	const messages: string[] = [];
	const session = await openPage(`${baseUrl}${path}`, {
		consoleLog: (message) => messages.push(message)
	});
	session.page.on('pageerror', (error) => messages.push(error.message));

	return { messages, session };
};

/* Hydrated, clicked once (so each island holds state its server render
 * does not), and marked so a reload is detectable. */
const prepareIslands = async (page: Page, islands: string[]) => {
	for (const component of islands) {
		await page.waitForSelector(
			`[data-island="true"][data-component="${component}"][data-hydrated="true"]`,
			{ timeout: 30_000 }
		);
	}
	await page.evaluate(() => Reflect.set(window, '__noReload', true));
};

const clickAndExpect = async (page: Page, selector: string, text: string) => {
	await page.click(selector);
	await waitForText(page, selector, text);
};

const expectNotReloaded = async (page: Page) => {
	expect(await page.evaluate(() => Reflect.get(window, '__noReload'))).toBe(
		true
	);
};

/* A fresh load renders the edit on the server and hydrates it with no
 * hydration warning or overlay. */
const expectCleanReload = async (
	path: string,
	selector: string,
	text: string
) => {
	const { messages, session } = await openWatched(path);
	try {
		await waitForText(session.page, selector, text);
		await Bun.sleep(1_000);
		expect(messages.filter(isHydrationWarning)).toEqual([]);
		expect(
			await session.page.evaluate(() =>
				document.body.innerText.includes('Hydration failed')
			)
		).toBe(false);
	} finally {
		await session.close();
	}
};

beforeAll(async () => {
	await ensureDistBuild();
	root = await mkdtemp(join(tmpdir(), 'absolute island hmr '));
	await Promise.all(
		Object.entries(FILES).map(async ([path, contents]) => {
			await mkdir(dirname(join(root, path)), { recursive: true });
			await writeFile(join(root, path), contents);
		})
	);
	await linkNodeModules(root);
	const port = await getAvailablePort();
	baseUrl = `http://localhost:${port}`;
	server = Bun.spawn(['bun', CLI_ENTRY, 'dev'], {
		cwd: root,
		env: {
			...process.env,
			FORCE_COLOR: '0',
			NODE_ENV: 'development',
			PORT: String(port),
			TELEMETRY_OFF: '1'
		},
		stderr: 'inherit',
		stdout: 'ignore'
	});
	await waitForServer();
}, 600_000);

afterAll(async () => {
	server?.kill();
	await server?.exited;
	if (root) await rm(root, { force: true, recursive: true });
});

describe('dev: HMR on pages with islands', () => {
	test('a React host page edit updates in place and keeps the islands alive', async () => {
		const { messages, session } = await openWatched('/islands');
		const { page } = session;
		try {
			await prepareIslands(page, [
				'ReactCounter',
				'SvelteCounter',
				'VueCounter'
			]);
			await clickAndExpect(page, '.react-island', 'REACT_ISLAND 4');
			await clickAndExpect(page, '.svelte-island', 'SVELTE_ISLAND 6');
			await clickAndExpect(page, '.vue-island', 'VUE_ISLAND 8');

			await editFile(
				'src/frontend/react/pages/IslandsPage.tsx',
				'>ISLANDS_PAGE<',
				'>ISLANDS_PAGE_EDITED<'
			);
			await waitForText(page, '.heading', 'ISLANDS_PAGE_EDITED');
			await editFile(
				'src/frontend/react/components/Label.tsx',
				'LABEL_TEXT',
				'LABEL_EDITED'
			);
			await waitForText(page, '.label', 'LABEL_EDITED');
			await expectNotReloaded(page);

			// The islands kept their state and still respond.
			expect(await textOf(page, '.react-island')).toBe('REACT_ISLAND 4');
			expect(await textOf(page, '.svelte-island')).toBe(
				'SVELTE_ISLAND 6'
			);
			expect(await textOf(page, '.vue-island')).toBe('VUE_ISLAND 8');
			await clickAndExpect(page, '.react-island', 'REACT_ISLAND 5');
			await clickAndExpect(page, '.svelte-island', 'SVELTE_ISLAND 7');
			await clickAndExpect(page, '.vue-island', 'VUE_ISLAND 9');
			expect(messages.filter(isHydrationWarning)).toEqual([]);
		} finally {
			await session.close();
		}
		await expectCleanReload('/islands', '.heading', 'ISLANDS_PAGE_EDITED');
	}, 120_000);

	type IslandCase = {
		file: string;
		from: string;
		name: 'React' | 'Svelte' | 'Vue';
		others: string[];
		selector: string;
		to: string;
	};
	const islandCases: IslandCase[] = [
		{
			file: 'src/islands/ReactCounter.tsx',
			from: 'REACT_ISLAND {count}',
			name: 'React',
			others: ['.svelte-island', '.vue-island'],
			selector: '.react-island',
			to: 'REACT_EDITED {count}'
		},
		{
			file: 'src/islands/SvelteCounter.svelte',
			from: 'SVELTE_ISLAND {count}',
			name: 'Svelte',
			others: ['.react-island', '.vue-island'],
			selector: '.svelte-island',
			to: 'SVELTE_EDITED {count}'
		},
		{
			file: 'src/islands/VueCounter.vue',
			from: 'VUE_ISLAND {{ count }}',
			name: 'Vue',
			others: ['.react-island', '.svelte-island'],
			selector: '.vue-island',
			to: 'VUE_EDITED {{ count }}'
		}
	];

	for (const island of islandCases) {
		test(`a ${island.name} island edit re-mounts that island in place`, async () => {
			const { messages, session } = await openWatched('/islands');
			const { page } = session;
			try {
				await prepareIslands(page, [
					'ReactCounter',
					'SvelteCounter',
					'VueCounter'
				]);
				for (const other of island.others) await page.click(other);
				const othersBefore = await Promise.all(
					island.others.map((other) => textOf(page, other))
				);

				await editFile(island.file, island.from, island.to);
				await page.waitForFunction(
					(target) =>
						/_EDITED \d+$/.test(
							document.querySelector(target)?.textContent ?? ''
						),
					island.selector,
					{ timeout: 30_000 }
				);
				await expectNotReloaded(page);

				// The other islands kept their state.
				expect(
					await Promise.all(
						island.others.map((other) => textOf(page, other))
					)
				).toEqual(othersBefore);
				// The re-mounted island responds.
				const before = (await textOf(page, island.selector)) ?? '';
				const count = Number(before.split(' ').pop());
				await page.click(island.selector);
				await waitForText(
					page,
					island.selector,
					before.replace(/\d+$/, String(count + 1))
				);
				expect(messages.filter(isHydrationWarning)).toEqual([]);
			} finally {
				await session.close();
			}
			const edited = island.to.replace(/ \{.*$/, '');
			const startByName: Record<string, number> = {
				React: 3,
				Svelte: 5,
				Vue: 7
			};
			await expectCleanReload(
				'/islands',
				island.selector,
				`${edited} ${startByName[island.name]}`
			);
		}, 120_000);
	}

	test('an island inside an HTML page updates in place', async () => {
		const { session } = await openWatched('/html');
		const { page } = session;
		try {
			await prepareIslands(page, ['ReactCounter']);
			await editFile(
				'src/islands/ReactCounter.tsx',
				'REACT_EDITED {count}',
				'REACT_AGAIN {count}'
			);
			await waitForText(page, '.react-island', 'REACT_AGAIN 1');
			await expectNotReloaded(page);
			await clickAndExpect(page, '.react-island', 'REACT_AGAIN 2');
		} finally {
			await session.close();
		}
		await expectCleanReload('/html', '.react-island', 'REACT_AGAIN 1');
	}, 120_000);
});
