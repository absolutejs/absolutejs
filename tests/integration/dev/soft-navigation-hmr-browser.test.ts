import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { openPage } from '../../helpers/browser';
import { startDevServer, type DevServer } from '../../helpers/devServer';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';
import { mutateFile, restoreAllFiles } from '../../helpers/file';

/* An HMR edit after a soft navigation applies to the page you are looking
 * at — the exit criterion for navigation phase 2.
 *
 * The dev HMR client is keyed on `window.__HMR_FRAMEWORK__`, which each
 * page's own bootstrap sets. A soft navigation replaces the body without
 * reloading, so nothing in that flow had ever been checked against the
 * HMR client: the plan listed it as "not verified" rather than broken.
 * The example app calls `enableNavigation()` nowhere, which is why it
 * stayed unverified — this fixture is the first app to do both. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
/* NOT under `.test-builds`: `HARD_DENY_PATTERN` in src/dev/pathUtils.ts
 * lists that directory, so the dev file watcher ignores every change
 * inside it — deliberately, to stop test fixtures feeding rebuild thrash
 * back into the watcher. A fixture there produces no rebuild and no HMR
 * message, and the test fails as a silent timeout with nothing in any log
 * to say why. `.hmr-temp/` is gitignored and not denied. */
const fixtureRoot = join(
	repoRoot,
	'.hmr-temp',
	`soft-navigation-hmr-${process.pid}`
);
const rel = (path: string) =>
	relative(repoRoot, join(fixtureRoot, path)).replace(/\\/g, '/');
const fromFixture = (...segments: string[]) =>
	relative(fixtureRoot, join(repoRoot, ...segments)).replace(/\\/g, '/');
/* Pages live at `<fixture>/<framework>/pages`, so their imports resolve
 * from two directories deeper than the fixture root. Both frameworks'
 * pages sit at the same depth. */
const fromPage = (...segments: string[]) =>
	relative(
		join(fixtureRoot, 'react', 'pages'),
		join(repoRoot, ...segments)
	).replace(/\\/g, '/');

const REACT_PAGE = `import { useEffect } from 'react';
import { enableNavigation } from '${fromPage('src', 'client', 'navigation')}';

export function DevNavReact() {
	useEffect(() => {
		enableNavigation();
	}, []);

	return (
		<html lang="en">
			<head>
				<title>React dev page</title>
			</head>
			<body>
				<div id="react-page">
					<a href="/svelte" id="to-svelte">svelte</a>
				</div>
			</body>
		</html>
	);
}
`;

const SVELTE_PAGE = `<script lang="ts">
	import { onMount } from 'svelte';
	import { enableNavigation } from '${fromPage('src', 'client', 'navigation')}';

	onMount(() => {
		enableNavigation();
		Reflect.set(window, '__svelteHydrated', true);
	});
</script>

<svelte:head><title>Svelte dev page</title></svelte:head>

<div id="svelte-page">
	<h1 id="headline">headline-before</h1>
	<a href="/react" id="to-react">react</a>
</div>
`;

const CONFIG = `import { defineConfig } from '${fromFixture('src', 'utils', 'defineConfig')}';

export default defineConfig({
	buildDirectory: '${rel('build')}',
	reactDirectory: '${rel('react')}',
	svelteDirectory: '${rel('svelte')}'
});
`;

const SERVER = `import { Elysia } from 'elysia';
import { asset, prepare } from '${fromFixture('src')}';
import { networking } from '${fromFixture('src', 'plugins', 'networking')}';
import { handleReactPageRequest } from '${fromFixture('src', 'react')}';
import { handleSveltePageRequest } from '${fromFixture('src', 'svelte')}';
import { DevNavReact } from './react/pages/DevNavReact';

const { absolutejs, manifest } = await prepare();

new Elysia()
	.use(absolutejs)
	.get('/react', ({ request }) =>
		handleReactPageRequest({
			index: asset(manifest, 'DevNavReactIndex'),
			Page: DevNavReact,
			props: {},
			request
		})
	)
	.get('/svelte', ({ request }) =>
		handleSveltePageRequest({
			indexPath: asset(manifest, 'DevNavSvelteIndex'),
			pagePath: asset(manifest, 'DevNavSvelte'),
			request
		})
	)
	.use(networking);
`;

const sveltePagePath = join(
	fixtureRoot,
	'svelte',
	'pages',
	'DevNavSvelte.svelte'
);

let server: DevServer | undefined;

beforeAll(async () => {
	await ensureDistBuild();
	await mkdir(join(fixtureRoot, 'react', 'pages'), { recursive: true });
	await mkdir(join(fixtureRoot, 'svelte', 'pages'), { recursive: true });
	await writeFile(
		join(fixtureRoot, 'react', 'pages', 'DevNavReact.tsx'),
		REACT_PAGE
	);
	await writeFile(sveltePagePath, SVELTE_PAGE);
	await writeFile(join(fixtureRoot, 'config.ts'), CONFIG);
	await writeFile(join(fixtureRoot, 'server.ts'), SERVER);
	server = await startDevServer({
		configPath: join(fixtureRoot, 'config.ts'),
		serverEntry: join(fixtureRoot, 'server.ts')
	});
}, 180_000);

afterAll(async () => {
	restoreAllFiles();
	await server?.kill();
	await rm(fixtureRoot, { force: true, recursive: true });
}, 30_000);

const baseUrl = () => {
	if (!server) throw new Error('dev server did not start');

	return server.baseUrl;
};

describe('dev: HMR after a soft navigation', () => {
	test('the swapped-in page owns the HMR client, and an edit reaches it', async () => {
		const documentLoads: string[] = [];
		const consoleLines: string[] = [];
		const session = await openPage(`${baseUrl()}/react`, {
			waitUntil: 'load',
			consoleLog: (message: string) => consoleLines.push(message)
		});
		try {
			const { page } = session;
			page.on('request', (request) => {
				if (request.resourceType() === 'document')
					documentLoads.push(request.url());
			});
			await page.evaluate(() =>
				Reflect.set(window, '__sameDocument', true)
			);

			await page.click('#to-svelte');
			await page.waitForFunction(
				() => Reflect.get(window, '__svelteHydrated') === true,
				undefined,
				{ timeout: 30_000 }
			);

			// The swap happened in place, not by loading the document.
			expect(
				await page.evaluate(
					() => Reflect.get(window, '__sameDocument') === true
				)
			).toBe(true);
			// The HMR client is keyed on this: while it still says `react`,
			// every update is routed to the framework that is no longer on
			// screen.
			expect(
				await page.evaluate(() =>
					Reflect.get(window, '__HMR_FRAMEWORK__')
				)
			).toBe('svelte');

			mutateFile(sveltePagePath, (source) =>
				source.replace('headline-before', 'headline-after')
			);

			await page.waitForFunction(
				() =>
					document.getElementById('headline')?.textContent ===
					'headline-after',
				undefined,
				{ timeout: 30_000 }
			);

			// Applied by HMR, not by the page being reloaded underneath us.
			expect(
				await page.evaluate(
					() => Reflect.get(window, '__sameDocument') === true
				)
			).toBe(true);
			expect(documentLoads).toEqual([]);
			// A hydration or HMR error would show up here rather than as a
			// missing update.
			expect(
				consoleLines.filter((line) => /error|mismatch/i.test(line))
			).toEqual([]);
		} finally {
			await session.close();
		}
	}, 180_000);
});
