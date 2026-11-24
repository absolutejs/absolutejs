import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import type { Page } from 'playwright';
import { build } from '../../../src/core/build';
import { handleSveltePageRequest } from '../../../src/svelte/pageHandler';
import { openPage, type BrowserSession } from '../../helpers/browser';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

/* A Svelte page that streams an `{#await}` block has to hydrate like any
 * other.
 *
 * It did not. `compileSvelte` built the index with `shouldHydrate = false`
 * for any page containing a streamed slot, so the page component was never
 * hydrated: no `onMount`, no event handlers, no reactivity. The page
 * rendered and then did nothing, which is the worst failure shape there
 * is — it looks finished. Documented as a deliberate trade-off ("the page
 * doesn't hydrate, because the streamed HTML isn't Svelte's to claim"),
 * and it does not have to be one: the streamed content is held until
 * hydration finishes and applied after it, which is machinery the Vue and
 * Angular slots already rely on (`client/streamSwap.ts`,
 * `__ABS_SLOT_HYDRATION_PENDING__`).
 *
 * So this asserts both halves: the page is interactive, AND the streamed
 * content is the resolved HTML rather than the pending fallback left
 * behind. Either one alone would pass while the other was broken. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const fixtureRoot = join(
	repoRoot,
	'.test-builds',
	`svelte-await-slot-${process.pid}`
);

const STREAMED_PAGE = `<script lang="ts">
	import { onMount } from 'svelte';

	let count = $state(0);

	const prices = async () => {
		await new Promise((done) => setTimeout(done, 120));

		return ['one', 'two', 'three'];
	};

	onMount(() => {
		Reflect.set(window, '__pageMounted', true);
	});
</script>

<svelte:head><title>Streamed await</title></svelte:head>

<div id="streamed-page">
	<button id="page-button" onclick={() => (count += 1)}>page {count}</button>
	<!-- absolute:stream -->
	{#await prices()}
		<p id="pending">loading</p>
	{:then list}
		<p id="resolved">{list.length} prices</p>
	{/await}
</div>
`;

/* The control: the same page without the streaming directive, so a
 * failure above cannot be "Svelte pages do not hydrate in this fixture". */
const PLAIN_PAGE = `<script lang="ts">
	import { onMount } from 'svelte';

	let count = $state(0);

	onMount(() => {
		Reflect.set(window, '__plainMounted', true);
	});
</script>

<svelte:head><title>Plain</title></svelte:head>

<div id="plain-page">
	<button id="plain-button" onclick={() => (count += 1)}>page {count}</button>
</div>
`;

type ServedApp = { baseUrl: string; stop: () => void };

let app: ServedApp | undefined;

const contentType = (path: string) => {
	if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
	if (path.endsWith('.css')) return 'text/css; charset=utf-8';

	return 'application/octet-stream';
};

const createApp =
	(buildDir: string, manifest: Record<string, string>) =>
	async (request: Request) => {
		const { pathname } = new URL(request.url);
		if (pathname === '/streamed')
			return handleSveltePageRequest({
				// Streaming slots are opt-in per handler call, and the flag
				// is top-level: nested under `options` it type-checks and
				// does nothing, and the page then renders its pending
				// fallback with nothing streamed behind it.
				collectStreamingSlots: true,
				indexPath: manifest.StreamedPageIndex ?? '',
				pagePath: manifest.StreamedPage ?? '',
				request
			});
		if (pathname === '/plain')
			return handleSveltePageRequest({
				indexPath: manifest.PlainPageIndex ?? '',
				pagePath: manifest.PlainPage ?? '',
				request
			});
		if (extname(pathname) === '')
			return new Response('not found', { status: 404 });
		const filePath = join(buildDir, pathname);
		if (!existsSync(filePath)) return new Response(null, { status: 404 });

		return new Response(Bun.file(filePath), {
			headers: { 'Content-Type': contentType(filePath) }
		});
	};

beforeAll(async () => {
	await ensureDistBuild();
	await mkdir(join(fixtureRoot, 'svelte', 'pages'), { recursive: true });
	await writeFile(
		join(fixtureRoot, 'svelte', 'pages', 'StreamedPage.svelte'),
		STREAMED_PAGE
	);
	await writeFile(
		join(fixtureRoot, 'svelte', 'pages', 'PlainPage.svelte'),
		PLAIN_PAGE
	);
	const rel = (path: string) =>
		relative(process.cwd(), join(fixtureRoot, path));
	const result = await build({
		buildDirectory: rel('build'),
		mode: 'production',
		options: { throwOnError: true },
		svelteDirectory: rel('svelte')
	});
	const server = Bun.serve({
		fetch: createApp(join(fixtureRoot, 'build'), result?.manifest ?? {}),
		port: 0
	});
	app = {
		baseUrl: `http://localhost:${server.port}`,
		stop: () => server.stop(true)
	};
}, 300_000);

afterAll(async () => {
	app?.stop();
	await rm(fixtureRoot, { force: true, recursive: true });
});

const baseUrl = () => {
	if (!app) throw new Error('fixture app is not running');

	return app.baseUrl;
};

const open = async (path: string, run: (page: Page) => Promise<void>) => {
	const session: BrowserSession = await openPage(`${baseUrl()}${path}`, {
		waitUntil: 'load'
	});
	try {
		await run(session.page);
	} finally {
		await session.close();
	}
};

const clickUntil = async (page: Page, button: string, text: string) => {
	await page.click(button);
	await page.waitForFunction(
		([selector, expected]) =>
			document.querySelector(selector)?.textContent?.trim() === expected,
		[button, text] as const,
		{ timeout: 10_000 }
	);
};

describe('a Svelte page with a streamed await block', () => {
	test('hydrates, and keeps the streamed content', async () => {
		await open('/streamed', async (page) => {
			await page.waitForFunction(
				() => Reflect.get(window, '__pageMounted') === true,
				undefined,
				{ timeout: 20_000 }
			);
			// The page's own reactivity, which is what was missing.
			await clickUntil(page, '#page-button', 'page 1');
			/* And the slot holds the RESOLVED content, not the pending
			 * fallback: hydration rewrites the slot with the fallback, and
			 * the streamed payload is re-applied afterwards. Asserting only
			 * interactivity would pass with the page showing "loading"
			 * forever. */
			await page.waitForSelector('#resolved', { timeout: 15_000 });

			expect(await page.locator('#resolved').textContent()).toContain(
				'3 prices'
			);
			expect(await page.locator('#pending').count()).toBe(0);
			/* And it got there through the swap runtime rather than by the
			 * server inlining it: only `client/streamSwap.ts` sets this
			 * attribute, and it is held until the index releases it after
			 * hydration (`__ABS_SLOT_HYDRATION_PENDING__`). Without this
			 * the test would pass just as well on a page whose slot never
			 * streamed at all. */
			expect(
				await page.evaluate(() =>
					document
						.querySelector('[data-absolute-slot]')
						?.getAttribute('data-absolute-slot-state')
				)
			).toBe('resolved');
		});
	}, 300_000);
});

describe('a Svelte page with no streamed block', () => {
	test('hydrates, as it always did', async () => {
		await open('/plain', async (page) => {
			await page.waitForFunction(
				() => Reflect.get(window, '__plainMounted') === true,
				undefined,
				{ timeout: 20_000 }
			);
			await clickUntil(page, '#plain-button', 'page 1');
		});
	}, 300_000);
});
