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

/* "Islands across a navigation" for VUE and ANGULAR — the two cells the
 * navigation matrix (2.4) still listed as untested.
 *
 * React and Svelte have had this since `islandDisposers` landed. Vue and
 * Angular are a separate question because each one treats island markup
 * its own way, and both have already been wrong about it once:
 *
 *   - Vue removes DOM children its vnode does not have, which is why
 *     `preserveIslandMarkup` exists.
 *   - Angular's island component writes its container's `innerHTML` from
 *     a snapshot, and used to re-create the container and hydrate twice.
 *
 * Those were found while making `persist` work — a MOVED island. This is
 * the ordinary case: an island on a page that is navigated away from and
 * then swapped back in. Three claims per framework:
 *
 *   1. entered cold, the island hydrates and runs;
 *   2. navigated away from, it stops running and is destroyed — not just
 *      flagged, since a teardown that left the interval going would set
 *      the flag and keep ticking;
 *   3. SWAPPED back in, it hydrates again. This is the cell that was
 *      untested, and the one with no cold-load path to fall back on: the
 *      islands runtime has to pick up the markup the layer inserted.
 *
 * A real `absolute start` app rather than an in-process server, because
 * an Angular page needs one — see `angular-persisted-island-browser` for
 * the NG0203 that costs. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'dist', 'cli', 'index.js');

/* The island reports its own life: `__ticks` keeps counting while it is
 * alive, and `__destroyed` records the teardown that stopped it. */
const TICKER = `<script lang="ts">
	import { onDestroy, onMount } from 'svelte';

	let timer: ReturnType<typeof setInterval> | undefined;

	const scope = () =>
		typeof window === 'undefined'
			? undefined
			: (window as unknown as Record<string, unknown>);

	onMount(() => {
		const target = scope();
		if (!target) return;
		const mounts = target.__mounts;
		target.__mounts = (typeof mounts === 'number' ? mounts : 0) + 1;
		target.__ticks = 0;
		timer = setInterval(() => {
			const ticks = target.__ticks;
			target.__ticks = (typeof ticks === 'number' ? ticks : 0) + 1;
		}, 20);
	});

	// Svelte runs onDestroy on the server too, as the SSR render closes,
	// so this cannot touch window unguarded.
	onDestroy(() => {
		if (timer !== undefined) clearInterval(timer);
		const target = scope();
		if (target) target.__destroyed = true;
	});
</script>

<output id="ticker">ticking</output>
`;

const FILES: Record<string, string> = {
	'absolute.config.ts': `import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	angularDirectory: './angular',
	buildDirectory: './build',
	islands: { registry: './islands/registry.ts' },
	svelteDirectory: './svelte',
	vueDirectory: './vue'
});
`,
	'angular/pages/ng-island-host.ts': `import { Component } from '@angular/core';
import { Island } from '@absolutejs/absolute/angular';

@Component({
	imports: [Island],
	selector: 'ng-island-host',
	standalone: true,
	template: \`
		<div id="angular-page" data-hydrated="true">
			<absolute-island
				component="Ticker"
				framework="svelte"
				hydrate="load"
			></absolute-island>
			<a href="/plain" id="to-plain">plain</a>
		</div>
	\`
})
export class NgIslandHost {
	ngOnInit() {
		if (typeof window === 'undefined') return;
		void import('@absolutejs/absolute/client/navigation').then(
			({ enableNavigation }) => {
				enableNavigation();
				Reflect.set(window, '__angularHydrated', true);
			}
		);
	}
}
`,
	'islands/registry.ts': `import { defineIslandRegistry } from '@absolutejs/absolute/islands';
import Ticker from './Ticker.svelte';

export const islandRegistry = defineIslandRegistry({ svelte: { Ticker } });
`,
	'islands/Ticker.svelte': TICKER,
	'package.json': `{ "name": "island-nav-matrix-app", "private": true, "type": "module" }
`,
	'server.ts': `import { Elysia } from 'elysia';
import { asset, networking, prepare } from '@absolutejs/absolute';
import { handleAngularPageRequest } from '@absolutejs/absolute/angular';
import { handleSveltePageRequest } from '@absolutejs/absolute/svelte';
import { handleVuePageRequest } from '@absolutejs/absolute/vue';

const { absolutejs, manifest } = await prepare();

export const server = new Elysia()
	.use(absolutejs)
	.get('/vue', ({ request }) =>
		handleVuePageRequest({
			indexPath: asset(manifest, 'VueIslandHostIndex'),
			pagePath: asset(manifest, 'VueIslandHost'),
			props: {},
			request
		})
	)
	.get('/angular', ({ request }) =>
		handleAngularPageRequest({
			indexPath: asset(manifest, 'NgIslandHostIndex'),
			pagePath: asset(manifest, 'NgIslandHost'),
			request
		})
	)
	.get('/plain', ({ request }) =>
		handleSveltePageRequest({
			indexPath: asset(manifest, 'PlainPageIndex'),
			pagePath: asset(manifest, 'PlainPage'),
			props: {},
			request
		})
	)
	.use(networking);
`,
	/* The navigation target, and the page the swap-back starts from. It
	   renders no island of its own, so an island still ticking after a
	   navigation to here is one that outlived its page. */
	'svelte/pages/PlainPage.svelte': `<script lang="ts">
	import { onMount } from 'svelte';
	import { enableNavigation } from '@absolutejs/absolute/client/navigation';

	onMount(() => {
		enableNavigation();
		Reflect.set(window, '__plainHydrated', true);
	});
</script>

<div id="plain-page">
	<a href="/vue" id="to-vue">vue</a>
	<a href="/angular" id="to-angular">angular</a>
</div>
`,
	'vue/pages/VueIslandHost.vue': `<script setup lang="ts">
import { onMounted } from 'vue';
import { enableNavigation } from '@absolutejs/absolute/client/navigation';
import { Island } from '@absolutejs/absolute/vue';

onMounted(() => {
	enableNavigation();
	(window as unknown as Record<string, unknown>).__vueHydrated = true;
});
</script>

<template>
	<div id="vue-page" data-hydrated="true">
		<Island
			component="Ticker"
			framework="svelte"
			hydrate="load"
			:props="{}"
		/>
		<a href="/plain" id="to-plain">plain</a>
	</div>
</template>
`
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

/* Processes whose command line names the app folder: the server child
 * `absolute start` spawned. */
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

const READY_ATTEMPTS = 360;
const READY_INTERVAL_MS = 500;

const startApp = async () => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-island-nav-'));
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

	for (let attempt = 0; attempt < READY_ATTEMPTS; attempt += 1) {
		if (proc.exitCode !== null) break;
		try {
			if ((await fetch(`${baseUrl}/vue`)).ok) return { baseUrl, stop };
		} catch {
			// not listening yet
		}
		await Bun.sleep(READY_INTERVAL_MS);
	}

	await stop();
	throw new Error('absolute start did not serve /vue');
};

let app: Awaited<ReturnType<typeof startApp>> | undefined;

beforeAll(async () => {
	await ensureDistBuild();
	app = await startApp();
}, 600_000);

afterAll(async () => {
	await app?.stop();
});

const baseUrl = () => {
	if (!app) throw new Error('fixture app is not running');

	return app.baseUrl;
};

const numberFrom = (page: Page, key: string) =>
	page.evaluate((name) => {
		const value = Reflect.get(window, name);

		return typeof value === 'number' ? value : -1;
	}, key);

const ticks = (page: Page) => numberFrom(page, '__ticks');
const mounts = (page: Page) => numberFrom(page, '__mounts');

const destroyed = (page: Page) =>
	page.evaluate(() => Reflect.get(window, '__destroyed'));

/** The document the page is on now, so a soft navigation can be told from
 *  a document load: a load resets this to a fresh object. */
const markDocument = (page: Page) =>
	page.evaluate(() => {
		Reflect.set(document, '__documentMark', true);
	});

const sameDocument = (page: Page) =>
	page.evaluate(() => Reflect.get(document, '__documentMark') === true);

/** Waits for the island's interval to advance, which no flag can fake. */
const waitForTicking = async (page: Page) => {
	const before = await ticks(page);
	await page.waitForFunction(
		(start) => {
			const value = Reflect.get(window, '__ticks');

			return typeof value === 'number' && value > start;
		},
		before,
		{ timeout: 15_000 }
	);
};

/* Angular's cell does not pass, and `test.skip` rather than absence is
 * deliberate: the reproduction belongs where the fix will be written.
 *
 * Measured, five runs, identical every time — an island on an Angular
 * page hydrates once on a cold load, tears down correctly when navigated
 * away from, and then mounts THREE more times when the page is swapped
 * back in. Four instances for one island, three orphaned, each with its
 * own interval. Vue's cell passes all three claims, so this is Angular's
 * island component rather than the islands runtime or the navigation
 * layer.
 *
 * What a bounded attempt at the cause ruled OUT, so the next one does not
 * start here:
 *
 *   - The islands runtime does dedupe, per ELEMENT
 *     (`dataset.hydrated` / `hydratingIslands`). Four mounts therefore
 *     means four distinct elements, not one element hydrated four times.
 *   - `findLiveIsland` can only adopt an island carrying an `island-id`
 *     or a `persist` key, and an ordinary island has neither — so a
 *     re-created container has nothing to recognise. Giving the component
 *     a reference to the island element it had already seen did NOT
 *     change the count.
 *   - Nor did looking for the island under the stable `absolute-island`
 *     HOST rather than the container it had been written into. So the
 *     extra writes are not one component instance, or one host, losing
 *     track of its island.
 *   - After the swap the DOM holds ONE island, one host, one
 *     `[ng-version]` root and one ticker: the three extra instances left
 *     no elements behind, so each was written, hydrated, and then
 *     replaced by the next write.
 *
 * Still open: where those writes come from. A stack probe over
 * `Element.prototype.innerHTML` is NOT the way to find out — patching it
 * breaks Angular's own rendering and the page never reaches the
 * assertion. */
const ANGULAR_SWAP_IN_DEFECT = true;

const hostCase = (framework: 'angular' | 'vue') => {
	const run =
		framework === 'angular' && ANGULAR_SWAP_IN_DEFECT ? test.skip : test;
	const path = `/${framework}`;
	const pageId = `#${framework}-page`;
	const hydratedFlag =
		framework === 'vue' ? '__vueHydrated' : '__angularHydrated';
	const backLinkId = `#to-${framework}`;

	describe(`an island on a ${framework} page`, () => {
		run(
			'hydrates cold, stops when navigated away from, and hydrates again when swapped back in',
			async () => {
				const session = await openPage(`${baseUrl()}${path}`, {
					waitUntil: 'load'
				});
				try {
					const { page } = session;
					await page.waitForFunction(
						(flag) => Reflect.get(window, flag) === true,
						hydratedFlag,
						{ timeout: 40_000 }
					);

					// 1. Cold: the island is running, mounted once.
					await page.waitForSelector('#ticker', { timeout: 20_000 });
					await waitForTicking(page);

					expect(await mounts(page)).toBe(1);
					expect(await destroyed(page)).toBeUndefined();

					// 2. Navigated away from: it stops and is destroyed.
					await markDocument(page);
					await page.click('#to-plain');
					await page.waitForSelector('#plain-page', {
						timeout: 20_000
					});

					expect(await sameDocument(page)).toBe(true);
					expect(await page.locator(pageId).count()).toBe(0);
					expect(await destroyed(page)).toBe(true);
					/* Work STOPPED, not just a flag set: a teardown that left
					 * the interval running would satisfy the flag and keep
					 * counting. */
					const stopped = await ticks(page);
					await page.waitForTimeout(300);

					expect(await ticks(page)).toBe(stopped);

					/* 3. Swapped back in — the cell the matrix listed as
					 * untested. There is no cold load to fall back on here:
					 * the islands runtime has to hydrate markup the
					 * navigation layer inserted. */
					await page.click(backLinkId);
					await page.waitForSelector(pageId, { timeout: 20_000 });

					expect(await sameDocument(page)).toBe(true);
					await page.waitForSelector('#ticker', { timeout: 20_000 });
					await waitForTicking(page);
					// A second mount: a new instance for the new markup.
					expect(await mounts(page)).toBe(2);
				} finally {
					await session.close();
				}
			},
			300_000
		);
	});
};

hostCase('vue');
hostCase('angular');
