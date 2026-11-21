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
import type { Page } from 'playwright';
import { openPage } from '../../helpers/browser';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';
import { getAvailablePort } from '../../helpers/ports';

/* Islands on a STATIC page, across a soft navigation — the half of
 * navigation phase 2's "React ↔ Svelte ↔ HTML ↔ HTMX with islands" that
 * the island teardown work did not reach. That work used a Svelte island
 * on a React page; a static page has no hydration index, so its islands
 * come up through the island bootstrap the build injects instead, and on
 * a swapped-in page they depend on the island runtime's MutationObserver
 * seeing markup the navigation layer inserted.
 *
 * Driven as a real installed app rather than a hand-rolled file server,
 * and that is not interchangeable here. A static page's island bootstrap
 * carries a module map pointing at the published client runtime's own
 * chunks (`./chunks/islands-*.js`, `./chunks/svelte-*.js`, …) resolved
 * relative to `/islands/`. The app build does not emit those into its
 * own output — a real server serves them — so a plain
 * `Bun.serve(join(buildDir, pathname))` 404s on
 * `/islands/chunks/index-*.js` and the island never hydrates. An earlier
 * draft of this test did exactly that and failed for that reason, which
 * is not a framework defect but is invisible unless you follow the 404.
 *
 * (The island teardown test gets away with a thin server because its
 * island arrives through the React page's hydration index, whose chunks
 * the page's client pass does emit under the build directory.)
 *
 * The fixture configures `svelteDirectory` even though no Svelte PAGE
 * exists. Without it `compileSvelte` never runs, so the island entry has
 * no compiled client path and `islandEntries` falls back to emitting the
 * registry definition with `component: null`. The build succeeds and the
 * island is dead on arrival. That is a real defect — the build should
 * compile the component or fail — and it is tracked separately; this
 * fixture steps around it so the navigation behaviour can be tested. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'dist', 'cli', 'index.js');

const FILES: Record<string, string> = {
	'absolute.config.ts': `import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	buildDirectory: './build',
	htmlDirectory: './html',
	islands: { registry: './islands/registry.ts' },
	reactDirectory: './react',
	// Required, and not obviously so: without it compileSvelte never
	// runs, the island entry has no compiled client path to point at, and
	// the build emits a registry definition whose component is null, so
	// the island is dead and the build still succeeds. See the note at
	// the top of this file.
	svelteDirectory: './svelte'
});
`,
	/* A static page whose only JavaScript is the island bootstrap the
	 * build injects: no hydration index, no framework page root. */
	'html/pages/plain.html': `<!doctype html>
<html lang="en">
	<head><title>Plain page</title></head>
	<body>
		<div id="plain-page">
			<absolute-island
				framework="svelte"
				component="Ticker"
				hydrate="load"
				props='{"label":"static-ticker"}'
			></absolute-island>
			<a href="/react" id="to-react">react</a>
		</div>
	</body>
</html>
`,
	'islands/registry.ts': `import { defineIslandRegistry } from '@absolutejs/absolute/islands';
import Ticker from './Ticker.svelte';

export const islandRegistry = defineIslandRegistry({ svelte: { Ticker } });
`,
	/* Its cleanup is observable from the page, and it keeps a timer
	 * running so "stopped" can be told apart from "a flag was set".
	 * Guarded on `window` because Svelte runs onDestroy during SSR too. */
	'islands/Ticker.svelte': `<script lang="ts">
	import { onDestroy, onMount } from 'svelte';

	let { label } = $props();
	let timer: ReturnType<typeof setInterval> | undefined;

	const scope = () =>
		typeof window === 'undefined'
			? undefined
			: (window as unknown as Record<string, unknown>);

	onMount(() => {
		const target = scope();
		if (!target) return;
		target.__staticIslandTicks = 0;
		timer = setInterval(() => {
			const ticks = target.__staticIslandTicks;
			target.__staticIslandTicks =
				(typeof ticks === 'number' ? ticks : 0) + 1;
		}, 20);
	});

	onDestroy(() => {
		if (timer !== undefined) clearInterval(timer);
		const target = scope();
		if (target) target.__staticIslandDestroyed = label;
	});
</script>

<output id="static-ticker">{label}</output>
`,
	'react/pages/StaticIslandHost.tsx': `import { useEffect } from 'react';
import { enableNavigation } from '@absolutejs/absolute/client/navigation';

export function StaticIslandHost() {
	useEffect(() => {
		enableNavigation();
	}, []);

	return (
		<html lang="en">
			<head>
				<title>React page</title>
			</head>
			<body>
				<div id="react-page" data-hydrated="true">
					<a href="/plain" id="to-plain">plain</a>
				</div>
			</body>
		</html>
	);
}
`,
	'server.ts': `import { Elysia } from 'elysia';
import { asset, handleHTMLPageRequest, networking, prepare } from '@absolutejs/absolute';
import { handleReactPageRequest } from '@absolutejs/absolute/react';
import { StaticIslandHost } from './react/pages/StaticIslandHost';

const { absolutejs, manifest } = await prepare();

export const server = new Elysia()
	.use(absolutejs)
	.get('/react', ({ request }) =>
		handleReactPageRequest({
			index: asset(manifest, 'StaticIslandHostIndex'),
			Page: StaticIslandHost,
			props: {},
			request
		})
	)
	.get('/plain', () => handleHTMLPageRequest(asset(manifest, 'plain')))
	.use(networking);
`,
	'svelte/pages/Placeholder.svelte': `<p>placeholder</p>\n`
};

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

const killSurvivors = async (root: string) => {
	const pgrep = Bun.spawn(['pgrep', '-f', root], {
		stderr: 'ignore',
		stdout: 'pipe'
	});
	const output = await new Response(pgrep.stdout).text();
	output
		.split('\n')
		.map(Number)
		.filter(
			(pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid
		)
		.forEach((pid) => {
			try {
				process.kill(pid, 'SIGKILL');
			} catch {
				// already gone
			}
		});
};

const startApp = async () => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-static-island-'));
	await Promise.all(
		Object.entries(FILES).map(async ([path, contents]) => {
			await mkdir(dirname(join(root, path)), { recursive: true });
			await writeFile(join(root, path), contents);
		})
	);
	await linkNodeModules(root);
	const port = await getAvailablePort();
	const proc = Bun.spawn(
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
	const baseUrl = `http://localhost:${port}`;
	const stop = async () => {
		proc.kill();
		await proc.exited;
		await killSurvivors(root);
		await rm(root, { force: true, recursive: true });
	};

	for (let attempt = 0; attempt < 360; attempt++) {
		if (proc.exitCode !== null) break;
		try {
			const response = await fetch(`${baseUrl}/plain`);
			if (response.ok) return { baseUrl, stop };
		} catch {
			// not listening yet
		}
		await Bun.sleep(500);
	}

	await stop();
	throw new Error('absolute start did not serve /plain');
};

type RunningApp = Awaited<ReturnType<typeof startApp>>;

let app: RunningApp | undefined;

beforeAll(async () => {
	await ensureDistBuild();
	app = await startApp();
}, 600_000);

afterAll(async () => {
	await app?.stop();
}, 60_000);

const baseUrl = () => {
	if (!app) throw new Error('app is not running');

	return app.baseUrl;
};

const ticks = (page: Page) =>
	page.evaluate(() => {
		const value = Reflect.get(window, '__staticIslandTicks');

		return typeof value === 'number' ? value : -1;
	});

const registered = (page: Page) =>
	page.evaluate(() => {
		const store = Reflect.get(
			globalThis,
			Symbol.for('absolute.islandDisposers')
		);

		return store instanceof Set ? store.size : -1;
	});

const hydratedAndTicking = async (page: Page) => {
	await page.waitForSelector('[data-island="true"][data-hydrated="true"]', {
		timeout: 30_000
	});
	await page.waitForFunction(
		() => {
			const value = Reflect.get(window, '__staticIslandTicks');

			return typeof value === 'number' && value > 0;
		},
		undefined,
		{ timeout: 20_000 }
	);
};

describe('an island on a static page', () => {
	test('hydrates when the page is entered directly', async () => {
		// The control: a failure here is the fixture or the app, not the
		// navigation layer.
		const noise: string[] = [];
		const session = await openPage(`${baseUrl()}/plain`, {
			waitUntil: 'load',
			consoleLog: (message: string) => noise.push(`console: ${message}`)
		});
		try {
			const { page } = session;
			page.on('pageerror', (error) =>
				noise.push(`error: ${error.message}`)
			);
			page.on('response', (response) => {
				if (response.status() >= 400)
					noise.push(`${response.status()} ${response.url()}`);
			});
			await hydratedAndTicking(page);

			expect(await registered(page)).toBe(1);
			/* Nothing 404s. The island runtime's own chunks are served out
			 * of the app's build (build/islandRuntimeChunks.ts); before
			 * that they were missing, and the only symptom was one 404 and
			 * an island that silently never came alive. */
			expect(noise).toEqual([]);
		} finally {
			await session.close();
		}
	}, 180_000);

	test('hydrates when swapped in, and is unmounted on the way out', async () => {
		const documentLoads: string[] = [];
		const errors: string[] = [];
		const session = await openPage(`${baseUrl()}/react`, {
			waitUntil: 'load'
		});
		try {
			const { page } = session;
			page.on('pageerror', (error) => errors.push(error.message));
			page.on('response', (response) => {
				if (response.status() >= 400)
					errors.push(`${response.status()} ${response.url()}`);
			});
			await page.waitForSelector('#react-page[data-hydrated="true"]', {
				timeout: 30_000
			});
			await page.evaluate(() =>
				Reflect.set(window, '__sameDocument', true)
			);
			page.on('request', (request) => {
				if (request.resourceType() === 'document')
					documentLoads.push(request.url());
			});

			await page.click('#to-plain');
			await page.waitForSelector('#plain-page', { timeout: 30_000 });
			// The island came up on markup the layer inserted, with no
			// hydration index on the page to start it.
			await hydratedAndTicking(page);

			expect(
				await page.evaluate(
					() => Reflect.get(window, '__sameDocument') === true
				)
			).toBe(true);
			expect(await registered(page)).toBe(1);

			await page.click('#to-react');
			await page.waitForSelector('#react-page[data-hydrated="true"]', {
				timeout: 30_000
			});

			/* Both, because they fail differently and the difference is
			 * the diagnosis: a non-empty registry means the disposer was
			 * never called, an empty one with no `onDestroy` means it ran
			 * but Svelte's teardown did not. */
			expect(
				await page.evaluate(() =>
					Reflect.get(window, '__staticIslandDestroyed')
				)
			).toBe('static-ticker');
			expect(await registered(page)).toBe(0);

			// And the work stopped, which the flag alone would not prove.
			const afterLeaving = await ticks(page);
			await page.waitForTimeout(200);

			expect(await ticks(page)).toBe(afterLeaving);
			expect(documentLoads).toEqual([]);
			expect(errors).toEqual([]);
		} finally {
			await session.close();
		}
	}, 240_000);
});
