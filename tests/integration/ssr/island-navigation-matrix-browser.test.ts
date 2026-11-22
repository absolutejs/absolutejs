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
		if (!target) return;
		const destroys = target.__destroys;
		target.__destroys = (typeof destroys === 'number' ? destroys : 0) + 1;
		target.__destroyed = true;
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

/** Mounts that have not been torn down: how many instances of the island
 *  are alive. One, always — a second is an orphan running its interval
 *  against nodes nobody can see. Counting instead of looking at the DOM is
 *  the point: an orphan is detached, so the DOM cannot see it either. */
const liveInstances = async (page: Page) =>
	(await mounts(page)) - (await numberFrom(page, '__destroys'));

const islandsInDom = (page: Page) =>
	page.evaluate(
		() => document.querySelectorAll('[data-island="true"]').length
	);

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

/* TWO round trips, not one, and a count of LIVE instances rather than
 * mounts alone. Both of those catch something a single trip could not.
 *
 * The island used to mount once per visit squared — 1, 4, 9, 16 — and the
 * orphans kept their intervals running. A soft navigation re-runs the
 * incoming page's module entries, and because a module URL evaluates once
 * per document, `moduleUrlFor` (client/navigation.ts) deliberately gives
 * the revisit a fresh URL so the entry runs again. The islands bootstrap
 * is one of those entries, and the runtime's "already hydrating" and
 * "already observing" sets were module-level — so every visit left another
 * instance of the runtime watching the document, each hydrating every
 * island element that appeared after it started.
 *
 * Measured on VUE the counts were 1, 2, 4, 7: one round trip gave the
 * right answer and the second one did not, which is why this test now
 * makes two. Angular was 1, 4, 9, 16 — the same defect one visit earlier,
 * because its island component creates the island element itself instead
 * of adopting the server's, late enough for two observers to see it.
 *
 * Correcting the note this comment used to carry: four mounts did NOT mean
 * four elements. A `data-hydrated` mutation record with `oldValue` showed
 * the SAME element going true → true, which is what sent the search to the
 * runtime's per-module state. The per-element dedupe was never the
 * problem; whose copy of it was doing the deduping was. */

const hostCase = (framework: 'angular' | 'vue') => {
	const path = `/${framework}`;
	const pageId = `#${framework}-page`;
	const hydratedFlag =
		framework === 'vue' ? '__vueHydrated' : '__angularHydrated';
	const backLinkId = `#to-${framework}`;

	describe(`an island on a ${framework} page`, () => {
		test('hydrates cold, stops when navigated away from, and hydrates again when swapped back in', async () => {
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
				expect(await liveInstances(page)).toBe(1);
				expect(await islandsInDom(page)).toBe(1);

				/* 4. And AGAIN. One round trip is satisfied by an island
				 * that mounts twice per visit as well as by one that
				 * mounts once; the second trip is where those part company
				 * (2, 4 against 2, 3). It is also the first visit on which
				 * a third copy of the islands runtime would exist. */
				await page.click('#to-plain');
				await page.waitForSelector('#plain-page', {
					timeout: 20_000
				});
				await page.click(backLinkId);
				await page.waitForSelector(pageId, { timeout: 20_000 });

				expect(await sameDocument(page)).toBe(true);
				await page.waitForSelector('#ticker', { timeout: 20_000 });
				await waitForTicking(page);

				expect(await mounts(page)).toBe(3);
				expect(await liveInstances(page)).toBe(1);
				expect(await islandsInDom(page)).toBe(1);
			} finally {
				await session.close();
			}
		}, 300_000);
	});
};

hostCase('vue');
hostCase('angular');
