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

/* A persisted island (`persist`) arriving on an ANGULAR page — the last
 * destination of navigation plan phase 5, and the one that needed a real
 * app rather than an in-process server (see `angular-navigation-browser`
 * for why: NG0203 from Angular's own root-view injector).
 *
 * Angular's island component writes its container's `innerHTML` from a
 * snapshot of the server's markup. That is right for a container it
 * filled and wrong for one holding a live island the navigation layer
 * moved in: the island would survive the navigation and then be destroyed
 * by the page it arrived on. This asserts it is not.
 *
 * The assertion that matters is IDENTITY, not appearance: the element in
 * the document after the navigation is the same object that was there
 * before it, held in a variable across the swap. A copy that looks alike
 * passes every other check — the previous revision of this phase's notes
 * recorded a mechanism that was wrong precisely because it asked "is an
 * island here?" instead of "is it the same one?". */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'dist', 'cli', 'index.js');

const FILES: Record<string, string> = {
	/* A page so `svelteDirectory` is a real directory. The island itself
	   lives under `islands/`, which is where the registry points. */
	'absolute.config.ts': `import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	angularDirectory: './angular',
	buildDirectory: './build',
	islands: { registry: './islands/registry.ts' },
	reactDirectory: './react',
	// The island is a Svelte component, so the build needs somewhere to
	// compile Svelte from — the check added in beta.243 says so by name
	// rather than shipping an island with no component.
	svelteDirectory: './svelte'
});
`,
	'angular/pages/ng-island-page.ts': `import { Component } from '@angular/core';
import { Island } from '@absolutejs/absolute/angular';

@Component({
	imports: [Island],
	selector: 'ng-island-page',
	standalone: true,
	template: \`
		<div id="angular-page" data-hydrated="true">
			<absolute-island
				component="Shell"
				framework="svelte"
				hydrate="load"
				persist="shell"
			></absolute-island>
			<a href="/react" id="to-react">react</a>
		</div>
	\`
})
export class NgIslandPage {
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
import Shell from './Shell.svelte';

export const islandRegistry = defineIslandRegistry({ svelte: { Shell } });
`,
	'islands/Shell.svelte': `<script lang="ts">
	import { onDestroy, onMount } from 'svelte';

	let ticks = $state(0);
	let timer: ReturnType<typeof setInterval> | undefined;

	const scope = () => (typeof window === 'undefined' ? undefined : window);

	onMount(() => {
		const target = scope();
		if (target) {
			const mounts = Reflect.get(target, '__islandMounts');
			Reflect.set(
				target,
				'__islandMounts',
				(typeof mounts === 'number' ? mounts : 0) + 1
			);
		}
		timer = setInterval(() => {
			ticks += 1;
		}, 50);
	});

	onDestroy(() => {
		if (timer !== undefined) clearInterval(timer);
		const target = scope();
		if (target) Reflect.set(target, '__islandDestroyed', true);
	});
</script>

<div id="shell-island">
	<input id="draft" placeholder="type here" />
	<output id="ticks">{ticks}</output>
</div>
`,
	'react/pages/IslandNavReact.tsx': `import { useEffect } from 'react';
import { enableNavigation } from '@absolutejs/absolute/client/navigation';
import { Island } from '@absolutejs/absolute/react';

export function IslandNavReact() {
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
					<Island
						component="Shell"
						framework="svelte"
						hydrate="load"
						persist="shell"
						props={{}}
					/>
					<a href="/angular" id="to-angular">angular</a>
				</div>
			</body>
		</html>
	);
}
`,
	'server.ts': `import { Elysia } from 'elysia';
import { asset, networking, prepare } from '@absolutejs/absolute';
import { handleAngularPageRequest } from '@absolutejs/absolute/angular';
import { handleReactPageRequest } from '@absolutejs/absolute/react';
import { IslandNavReact } from './react/pages/IslandNavReact';

const { absolutejs, manifest } = await prepare();

export const server = new Elysia()
	.use(absolutejs)
	.get('/react', ({ request }) =>
		handleReactPageRequest({
			index: asset(manifest, 'IslandNavReactIndex'),
			Page: IslandNavReact,
			props: {},
			request
		})
	)
	.get('/angular', ({ request }) =>
		handleAngularPageRequest({
			indexPath: asset(manifest, 'NgIslandPageIndex'),
			pagePath: asset(manifest, 'NgIslandPage'),
			request
		})
	)
	.use(networking);
`,
	/* A page so `svelteDirectory` is a real directory: the island is a
	   Svelte component, and the build refuses to ship an island whose
	   framework has nowhere to compile from. The island itself lives under
	   `islands/`, where the registry points. */
	'svelte/pages/Unused.svelte': `<div id="unused">unused</div>\n`
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

const startApp = async () => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-angular-nav-'));
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
			const response = await fetch(`${baseUrl}/angular`);
			if (response.ok) return { baseUrl, stop };
		} catch {
			// not listening yet
		}
		await Bun.sleep(500);
	}

	await stop();
	throw new Error('absolute start did not serve /angular');
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

const pathnameOf = (page: Page) => new URL(page.url()).pathname;

const sameDocument = (page: Page) =>
	page.evaluate(() => Reflect.get(window, '__sameDocument') === true);

const draftValue = (page: Page) =>
	page.evaluate(
		() =>
			(document.getElementById('draft') as HTMLInputElement | null)?.value
	);

const mounts = (page: Page) =>
	page.evaluate(() => Reflect.get(window, '__islandMounts'));

const destroyed = (page: Page) =>
	page.evaluate(() => Reflect.get(window, '__islandDestroyed'));

const isLiveIslandStillThere = (page: Page) =>
	page.evaluate(() => {
		const live = Reflect.get(window, '__liveIsland');

		return (
			live instanceof Element &&
			live.isConnected &&
			live === document.querySelector('[data-island]')
		);
	});

/* An Angular page entered cold still hydrates its island TWICE, and that
 * is deliberately not asserted either way here: pinning 2 would lock in a
 * defect, and asserting 1 would fail until it is found. What is known is
 * in the plan doc (4i), including the four explanations ruled out — the
 * component writing twice (fixed, it writes once now), a detached element
 * being hydrated, two copies of the islands runtime racing on the same
 * element, and Vue-style re-creation. Two disposers for one element in the
 * document means a SECOND element exists somewhere; finding where it comes
 * from is the next step. */
describe('a persisted island arriving on an Angular page', () => {
	test('is the same instance that crossed, not a copy', async () => {
		const documentLoads: string[] = [];
		const session = await openPage(`${baseUrl()}/react`, {
			waitUntil: 'load'
		});
		try {
			const { page } = session;
			page.on('request', (request) => {
				if (request.resourceType() === 'document')
					documentLoads.push(request.url());
			});
			await page.waitForSelector('#shell-island', { timeout: 30_000 });
			await page.waitForFunction(
				() => {
					const value = Reflect.get(window, '__islandMounts');

					return typeof value === 'number' && value >= 1;
				},
				undefined,
				{ timeout: 30_000 }
			);
			await page.evaluate(() =>
				Reflect.set(window, '__sameDocument', true)
			);
			await page.fill('#draft', 'into angular');
			// Held across the swap: the assertion is identity, not
			// appearance. A fresh island with the same markup passes every
			// other check.
			await page.evaluate(() =>
				Reflect.set(
					window,
					'__liveIsland',
					document.querySelector('[data-island]')
				)
			);

			await page.click('#to-angular');
			await page.waitForFunction(
				() => Reflect.get(window, '__angularHydrated') === true,
				undefined,
				{ timeout: 30_000 }
			);
			await page.waitForTimeout(2000);

			expect(pathnameOf(page)).toBe('/angular');
			expect(await sameDocument(page)).toBe(true);
			expect(await isLiveIslandStillThere(page)).toBe(true);
			expect(await mounts(page)).toBe(1);
			expect(await destroyed(page)).toBeUndefined();
			expect(await draftValue(page)).toBe('into angular');
			expect(documentLoads).toEqual([]);
		} finally {
			await session.close();
		}
	}, 300_000);
});

describe('an island on an Angular page', () => {
	test('is interactive, and still is after navigating into the page', async () => {
		const documentLoads: string[] = [];
		const errors: string[] = [];
		const session = await openPage(`${baseUrl()}/react`, {
			waitUntil: 'load'
		});
		try {
			const { page } = session;
			page.on('pageerror', (error) => errors.push(error.message));
			page.on('request', (request) => {
				if (request.resourceType() === 'document')
					documentLoads.push(request.url());
			});
			await page.waitForSelector('#shell-island', { timeout: 30_000 });
			await page.evaluate(() =>
				Reflect.set(window, '__sameDocument', true)
			);

			await page.click('#to-angular');
			await page.waitForFunction(
				() => Reflect.get(window, '__angularHydrated') === true,
				undefined,
				{ timeout: 30_000 }
			);
			// Angular writes its island container in `ngAfterViewInit`, after
			// the page reports itself hydrated, so settle before asking.
			await page.waitForTimeout(1500);

			expect(pathnameOf(page)).toBe('/angular');
			expect(await sameDocument(page)).toBe(true);
			expect(await page.locator('#shell-island').count()).toBe(1);
			/* Interactive, which is the claim: typing into the island's input
			 * reaches a live instance. The VALUE from the previous page is
			 * gone — that is the `persist` gap, recorded in the plan doc. */
			await page.fill('#draft', 'typed on angular');

			expect(await draftValue(page)).toBe('typed on angular');
			await page.waitForFunction(
				() =>
					Number(
						document.getElementById('ticks')?.textContent?.trim() ??
							'-1'
					) > 0,
				undefined,
				{ timeout: 15_000 }
			);
			expect(documentLoads).toEqual([]);
			expect(errors).toEqual([]);
		} finally {
			await session.close();
		}
	}, 300_000);
});
