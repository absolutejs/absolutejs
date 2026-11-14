import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
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
import { dirname, join, resolve } from 'node:path';
import { openPage } from '../../helpers/browser';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';
import { getAvailablePort } from '../../helpers/ports';

/* A React page that renders an <Island> injects the build manifest into the
 * page as `window.__ABSOLUTE_MANIFEST__`, minus the entries that are paths
 * on the server's disk. `absolute start` bundles the app against the
 * published package, whose entry points (dist/index.js, dist/react/index.js,
 * ...) each carry a copy of the island page context. prepare() recorded the
 * build directory in one copy while the React page handler filtered with
 * another that never saw it, so every SSR page, server bundle and static
 * HTML page path leaked into the page. This runs that exact setup: a
 * React + Svelte + HTML app with islands, built and served with
 * `absolute start`. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'dist', 'cli', 'index.js');

const FILES: Record<string, string> = {
	'absolute.config.ts': `import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	buildDirectory: './build',
	htmlDirectory: './html',
	islands: { registry: './islands/registry.ts' },
	reactDirectory: './react',
	svelteDirectory: './svelte'
});
`,
	'html/pages/About.html': `<!DOCTYPE html>
<html>
	<head>
		<meta charset="utf-8" />
		<title>About</title>
	</head>
	<body>
		<h1>HTML_ABOUT_PAGE</h1>
	</body>
</html>
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
	'react/pages/PlainPage.tsx': `export const PlainPage = () => (
	<html>
		<head>
			<meta charSet="utf-8" />
			<title>Plain</title>
		</head>
		<body>
			<h1>PLAIN_PAGE</h1>
		</body>
	</html>
);
`,
	'server.ts': `import { Elysia } from 'elysia';
import { asset, handleHTMLPageRequest, networking, prepare } from '@absolutejs/absolute';
import { handleReactPageRequest } from '@absolutejs/absolute/react';
import { handleSveltePageRequest } from '@absolutejs/absolute/svelte';
import { IslandsPage } from './react/pages/IslandsPage';
import { PlainPage } from './react/pages/PlainPage';

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
	.get('/plain', () =>
		handleReactPageRequest({
			index: asset(manifest, 'PlainPageIndex'),
			Page: PlainPage,
			props: {}
		})
	)
	.get('/svelte', () =>
		handleSveltePageRequest({
			indexPath: asset(manifest, 'SvelteHomeIndex'),
			pagePath: asset(manifest, 'SvelteHome'),
			props: {}
		})
	)
	.get('/about', () => handleHTMLPageRequest(asset(manifest, 'About')))
	.use(networking);
`,
	'svelte/components/SvelteCounter.svelte': `<script lang="ts">
	let { start }: { start: number } = $props();
	let count = $state(start);
</script>

<button class="svelte-island" onclick={() => (count += 1)} type="button">SVELTE_ISLAND {count}</button>
`,
	'svelte/pages/SvelteHome.svelte': `<svelte:head>
	<title>Svelte home</title>
</svelte:head>

<h1>SVELTE_HOME</h1>
`
};

const PAGE_ROUTES = ['/islands', '/plain', '/svelte', '/about'];

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
let rootAliases: string[] = [];
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

const readInjectedManifest = (html: string) => {
	const match = /window\.__ABSOLUTE_MANIFEST__ = (\{.*?\})<\/script>/.exec(
		html
	);
	if (!match?.[1]) return undefined;
	const parsed: Record<string, string> = JSON.parse(match[1]);

	return parsed;
};

beforeAll(async () => {
	await ensureDistBuild();
	root = await mkdtemp(join(tmpdir(), 'absolute-prod-islands-paths-'));
	// macOS tmpdir is a symlink (/var -> /private/var); the server sees the
	// resolved path, so check for both spellings of the project root.
	rootAliases = [...new Set([root, await realpath(root)])];
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

describe('production island pages do not publish server paths', () => {
	test('the build manifest itself holds absolute server paths', async () => {
		const buildDir = join(await realpath(root), 'start-build');
		const manifest: Record<string, string> = JSON.parse(
			readFileSync(join(buildDir, 'manifest.json'), 'utf-8')
		);
		const serverEntries = Object.values(manifest).filter((value) =>
			rootAliases.some((alias) => value.startsWith(alias))
		);

		expect(serverEntries.length).toBeGreaterThan(0);
	});

	test('no served page contains the project root', async () => {
		for (const route of PAGE_ROUTES) {
			const response = await fetch(`${baseUrl}${route}`);
			const html = await response.text();

			expect(`${route} ${response.status}`).toBe(`${route} 200`);
			for (const alias of rootAliases) {
				expect(`${route} ${html.includes(alias)}`).toBe(
					`${route} false`
				);
			}
		}
	});

	test('the island page manifest keeps only web paths', async () => {
		const html = await (await fetch(`${baseUrl}/islands`)).text();
		const manifest = readInjectedManifest(html);

		expect(manifest).toBeDefined();
		const values = Object.values(manifest ?? {});
		expect(values.length).toBeGreaterThan(0);
		for (const value of values) {
			expect(value.startsWith('/')).toBe(true);
			for (const alias of rootAliases) {
				expect(value.startsWith(alias)).toBe(false);
			}
		}
	});

	test('both islands render on the server', async () => {
		const html = await (await fetch(`${baseUrl}/islands`)).text();

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
});
