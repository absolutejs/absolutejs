import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openPage } from '../../helpers/browser';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';
import {
	linkNodeModules,
	writeFileRoutesFixture
} from '../../helpers/fileRoutesFixture';

/* A React file route under nested layouts has to HYDRATE onto the markup
 * the server sent.
 *
 * The server composes the chain in `react/fileRoute.ts` and the generated
 * hydration index composes it again in `generateReactIndexes.ts`. Those are
 * two separate pieces of code building the same tree, and if they disagree
 * — a different order, a missing layout — React does not fail. It discards
 * the server's tree and renders the root again on the client, which looks
 * correct on screen and throws away the server render. So "the page looks
 * right" cannot be the assertion.
 *
 * What distinguishes the two is whether the server's own DOM survived: the
 * outer layout runs an inline script while the document parses, marking
 * every element the server sent. A kept tree still carries the marks; a
 * re-rendered one does not. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'dist', 'cli', 'index.js');
const PORT = 4526;
const READY_ATTEMPTS = 240;
const READY_INTERVAL_MS = 250;

let root = '';
let server: ReturnType<typeof Bun.spawn> | undefined;

const pageUrl = `http://localhost:${PORT}/plans/pricing`;

beforeAll(async () => {
	await ensureDistBuild();
	root = await mkdtemp(join(tmpdir(), 'absolute-route-layouts-'));
	await writeFileRoutesFixture(root);
	await linkNodeModules(root);
	server = Bun.spawn(
		['bun', CLI_ENTRY, 'start', 'server.ts', '--outdir', 'start-build'],
		{
			cwd: root,
			env: {
				...process.env,
				FORCE_COLOR: '0',
				NODE_ENV: 'production',
				PORT: String(PORT),
				TELEMETRY_OFF: '1'
			},
			stderr: 'pipe',
			stdout: 'pipe'
		}
	);
	const ready = async () => {
		try {
			return (await fetch(pageUrl)).status === 200;
		} catch {
			return false;
		}
	};
	for (let attempt = 0; attempt < READY_ATTEMPTS; attempt += 1) {
		if (await ready()) return;
		await Bun.sleep(READY_INTERVAL_MS);
	}
	throw new Error('timed out waiting for the production server');
}, 600_000);

afterAll(async () => {
	server?.kill();
	await server?.exited;
	if (root) await rm(root, { force: true, recursive: true });
});

describe('a React file route under nested layouts', () => {
	test('hydrates onto the server markup the layouts produced', async () => {
		const consoleMessages: string[] = [];
		const session = await openPage(pageUrl, {
			waitUntil: 'load',
			consoleLog: (message: string) => consoleMessages.push(message)
		});
		try {
			const { page } = session;
			await page.waitForFunction(
				() => Reflect.get(window, '__pricingHydrated') === true,
				undefined,
				{ timeout: 30_000 }
			);

			// The layouts are in the live DOM, nested outer → inner.
			expect(
				await page
					.locator('#marketing-layout #plans-layout #pricing')
					.count()
			).toBe(1);

			/* And every one of them is the server's own element. A chain
			 * composed differently on the client would have cost all three
			 * marks, the page's included. */
			expect(
				await page.evaluate(() =>
					['marketing-layout', 'plans-layout', 'pricing'].map((id) =>
						document
							.getElementById(id)
							?.hasAttribute('data-from-server')
					)
				)
			).toEqual([true, true, true]);

			// Interactive, so this is hydration rather than inert markup.
			await page.click('#pricing-clicks');
			await page.waitForFunction(
				() =>
					document
						.querySelector('#pricing-clicks')
						?.textContent?.trim() === 'clicks 1',
				undefined,
				{ timeout: 10_000 }
			);

			// A mismatch is reported through this path; there was none.
			expect(consoleMessages.join(' ')).not.toContain(
				'React recoverable error'
			);
		} finally {
			await session.close();
		}
	}, 300_000);

	/* A SVELTE route under layouts has to hydrate too, and its risk is
	 * different from React's. Svelte wraps the layouts in the page's
	 * source, so one compiled module carries the whole tree and the two
	 * sides cannot disagree about the order — but the page's own slot
	 * handling can still go wrong, since a Svelte island slot writes only
	 * when it is empty and a layout now stands between the page and the
	 * markup it hydrates into. */
	test('hydrates a Svelte route inside its layouts', async () => {
		const session = await openPage(
			`http://localhost:${PORT}/guides/routing`,
			{ waitUntil: 'load' }
		);
		try {
			const { page } = session;
			await page.waitForSelector('#guide-topic', { timeout: 30_000 });

			expect(
				await page
					.locator('#svelte-root-layout #guides-layout #guide-topic')
					.count()
			).toBe(1);
			expect(await page.locator('#guide-topic').textContent()).toBe(
				'GUIDE_routing'
			);
			// Interactive: the page's own state works inside the layouts.
			await page.click('#guide-clicks');
			await page.waitForFunction(
				() =>
					document
						.querySelector('#guide-clicks')
						?.textContent?.trim() === 'clicks 1',
				undefined,
				{ timeout: 10_000 }
			);
		} finally {
			await session.close();
		}
	}, 300_000);

	/* A VUE route under layouts. Its risk is the one Vue has had before
	 * in this area: a layout now stands between the page and the markup
	 * it hydrates into, and Vue's slot handling is where `persist` and
	 * island markup have gone wrong twice. */
	test('hydrates a Vue route inside its layouts', async () => {
		const session = await openPage(`http://localhost:${PORT}/shop/widget`, {
			waitUntil: 'load'
		});
		try {
			const { page } = session;
			await page.waitForSelector('#item', { timeout: 30_000 });

			expect(
				await page
					.locator('#vue-root-layout #shop-layout #item')
					.count()
			).toBe(1);
			expect(await page.locator('#item').textContent()).toBe(
				'ITEM_widget'
			);
			// The private sibling the page imports still renders.
			expect(await page.locator('.tag').textContent()).toBe('VUE_CHILD');
			// Interactive inside the layouts.
			await page.click('#vue-clicks');
			await page.waitForFunction(
				() =>
					document
						.querySelector('#vue-clicks')
						?.textContent?.trim() === 'clicks 1',
				undefined,
				{ timeout: 10_000 }
			);
		} finally {
			await session.close();
		}
	}, 300_000);

	/* The `loading` convention, which until now was scanned, compiled,
	 * shipped and never read by anything.
	 *
	 * It is shown over the live document while a soft navigation is in
	 * flight, after a delay, so a fast swap does not flash it. Both halves
	 * are asserted: it appears on a navigation that outlasts the delay,
	 * and it is gone once the page arrives. The fast case is checked too,
	 * because an indicator that is always shown is as wrong as one that
	 * never is — and the first would pass a test that only looked for it
	 * on the slow route. */
	test('shows the loading convention while a slow navigation is in flight', async () => {
		const session = await openPage(pageUrl, { waitUntil: 'load' });
		try {
			const { page } = session;
			await page.waitForFunction(
				() => Reflect.get(window, '__pricingHydrated') === true,
				undefined,
				{ timeout: 30_000 }
			);
			// Nothing is shown while the page sits there.
			expect(await page.locator('#nav-loading').count()).toBe(0);

			await page.click('#to-slow');
			// The route sleeps 900ms in `load`; the delay is 150ms.
			await page.waitForSelector('#nav-loading', { timeout: 10_000 });

			// And it goes once the page it was covering arrives.
			await page.waitForSelector('#slow', { timeout: 20_000 });
			expect(await page.locator('#slow').textContent()).toBe(
				'SLOW_READY'
			);
			await page.waitForFunction(
				() => document.querySelectorAll('#nav-loading').length === 0,
				undefined,
				{ timeout: 10_000 }
			);
		} finally {
			await session.close();
		}
	}, 300_000);

	test('leaves a fast navigation alone', async () => {
		const session = await openPage(pageUrl, { waitUntil: 'load' });
		try {
			const { page } = session;
			await page.waitForFunction(
				() => Reflect.get(window, '__pricingHydrated') === true,
				undefined,
				{ timeout: 30_000 }
			);
			/* Watched from the moment of the click rather than checked
			 * afterwards: an indicator that appeared and was removed would
			 * be invisible to a check that ran after the swap. */
			await page.evaluate(() => {
				Reflect.set(window, '__sawLoading', false);
				const observer = new MutationObserver(() => {
					if (document.querySelector('#nav-loading'))
						Reflect.set(window, '__sawLoading', true);
				});
				observer.observe(document.body, {
					childList: true,
					subtree: true
				});
			});

			await page.click('#to-compare');
			await page.waitForSelector('#compare', { timeout: 20_000 });

			expect(
				await page.evaluate(() => Reflect.get(window, '__sawLoading'))
			).toBe(false);
		} finally {
			await session.close();
		}
	}, 300_000);

	/* The point of a layout, once soft navigation is on: an island declared
	 * ONCE in the layout keeps running while the routes under it change.
	 * The key is written in one place, and every route below renders it —
	 * which is what `persist` matches on — so this is 4.3's ergonomics
	 * arriving from 4.2 rather than from a new mechanism.
	 *
	 * Asserting the island is still on the page would prove nothing: a
	 * re-created one looks identical. What distinguishes them is the mount
	 * count, the destroy flag, and the DOM state it was carrying. */
	test('keeps its island alive across routes that share it', async () => {
		const session = await openPage(pageUrl, { waitUntil: 'load' });
		try {
			const { page } = session;
			await page.waitForFunction(
				() => Reflect.get(window, '__counterMounts') === 1,
				undefined,
				{ timeout: 30_000 }
			);
			await page.fill('#counter-draft', 'kept');
			const ticksBefore = Number(
				await page.locator('#counter-ticks').textContent()
			);

			await page.click('#to-compare');
			await page.waitForSelector('#compare', { timeout: 20_000 });

			// A soft navigation: same document, different route.
			expect(new URL(page.url()).pathname).toBe('/plans/compare');
			expect(await page.locator('#pricing').count()).toBe(0);
			/* The same instance, moved: mounted once in total, never
			 * destroyed, still holding what was typed into it, and its
			 * interval still counting. */
			expect(
				await page.evaluate(() =>
					Reflect.get(window, '__counterMounts')
				)
			).toBe(1);
			expect(
				await page.evaluate(() =>
					Reflect.get(window, '__counterDestroyed')
				)
			).toBeUndefined();
			expect(await page.inputValue('#counter-draft')).toBe('kept');
			await page.waitForFunction(
				(before) =>
					Number(
						document.querySelector('#counter-ticks')?.textContent ??
							'0'
					) > before,
				ticksBefore,
				{ timeout: 10_000 }
			);

			/* And leaving the layout tears it down. A key the incoming page
			 * does not render is deliberately NOT persisted — otherwise the
			 * island outlives the layout that declared it, which is the
			 * leak `persist` was careful to avoid. */
			await page.click('#to-pricing');
			await page.waitForSelector('#pricing', { timeout: 20_000 });
			await page.click('#to-blog');
			await page.waitForSelector('#blog-page', { timeout: 20_000 });

			expect(await page.locator('#counter-island').count()).toBe(0);
			expect(
				await page.evaluate(() =>
					Reflect.get(window, '__counterDestroyed')
				)
			).toBe(true);
		} finally {
			await session.close();
		}
	}, 300_000);
});
