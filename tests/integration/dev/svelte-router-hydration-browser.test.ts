import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { openPage } from '../../helpers/browser';
import { startDevServer, type DevServer } from '../../helpers/devServer';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

/* A Svelte router page hydrates cleanly under `absolute dev`.
 *
 * The dev client compiles every component with Svelte's `hmr` option, and
 * `hmr` changes the server markup too: a component that is the only child of
 * a fragment (each page's <Router>, and the <Route> inside its children) gets
 * an anchor comment after it. The server render was compiled without `hmr`,
 * left the anchors out, and every router page logged
 * `[svelte] hydration_mismatch` in dev, then re-mounted from scratch.
 * Production compiles both sides without `hmr`, so it was never affected. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const fixtureRoot = join(
	repoRoot,
	'.test-builds',
	`svelte-router-dev-hydration-${process.pid}`
);
// The published router components, as an app gets them (see
// tests/integration/build/svelte-router-browser.test.ts).
const routerDir = relative(
	join(fixtureRoot, 'svelte', 'pages'),
	join(repoRoot, 'dist', 'svelte', 'router')
);
const rel = (path: string) =>
	relative(repoRoot, join(fixtureRoot, path)).replace(/\\/g, '/');

const ROUTER_PAGE = `<script lang="ts">
	import { onMount } from 'svelte';
	import Router from '${routerDir}/Router.svelte';
	import Route from '${routerDir}/Route.svelte';

	let { url }: { url?: string } = $props();
	let count = $state(0);

	onMount(() => {
		Reflect.set(window, '__hydrated', true);
	});
</script>

<Router {url}>
	<Route path="/app">
		{#snippet content()}
			<h1 id="home">Home</h1>
			<button id="count" onclick={() => count++}>count {count}</button>
		{/snippet}
	</Route>
</Router>
`;

const CONFIG = `import { defineConfig } from '${relative(fixtureRoot, join(repoRoot, 'src', 'utils', 'defineConfig'))}';

export default defineConfig({
	buildDirectory: '${rel('build')}',
	svelteDirectory: '${rel('svelte')}'
});
`;

const SERVER = `import { Elysia } from 'elysia';
import { asset, prepare } from '${relative(fixtureRoot, join(repoRoot, 'src'))}';
import { networking } from '${relative(fixtureRoot, join(repoRoot, 'src', 'plugins', 'networking'))}';
import { handleSveltePageRequest } from '${relative(fixtureRoot, join(repoRoot, 'src', 'svelte'))}';

const { absolutejs, manifest } = await prepare();

new Elysia()
	.use(absolutejs)
	.get('/app', ({ request }) =>
		handleSveltePageRequest({
			indexPath: asset(manifest, 'RouterAppIndex'),
			pagePath: asset(manifest, 'RouterApp'),
			request
		})
	)
	.use(networking);
`;

let server: DevServer | undefined;

beforeAll(async () => {
	await ensureDistBuild();
	await mkdir(join(fixtureRoot, 'svelte', 'pages'), { recursive: true });
	await writeFile(
		join(fixtureRoot, 'svelte', 'pages', 'RouterApp.svelte'),
		ROUTER_PAGE
	);
	await writeFile(join(fixtureRoot, 'config.ts'), CONFIG);
	await writeFile(join(fixtureRoot, 'server.ts'), SERVER);
	server = await startDevServer({
		configPath: join(fixtureRoot, 'config.ts'),
		serverEntry: join(fixtureRoot, 'server.ts')
	});
}, 120_000);

afterAll(async () => {
	await server?.kill();
	await rm(fixtureRoot, { force: true, recursive: true });
}, 30_000);

describe('dev: Svelte router hydration', () => {
	test('a router page hydrates without a hydration warning', async () => {
		if (!server) throw new Error('dev server did not start');
		const messages: string[] = [];
		const session = await openPage(`${server.baseUrl}/app`, {
			consoleLog: (message) => messages.push(message)
		});
		try {
			const { page } = session;
			await page.waitForFunction(
				() => Reflect.get(window, '__hydrated') === true,
				undefined,
				{ timeout: 20_000 }
			);
			// The page is interactive.
			await page.click('#count');
			await page.waitForFunction(
				() =>
					document.getElementById('count')?.textContent === 'count 1',
				undefined,
				{ timeout: 10_000 }
			);

			expect(
				messages.filter((text) => text.includes('hydration'))
			).toEqual([]);
		} finally {
			await session.close();
		}
	}, 90_000);
});
