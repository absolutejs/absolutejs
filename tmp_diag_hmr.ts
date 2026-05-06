/* Playwright-driven HMR diagnostic.
 *
 * Goal: figure out why ɵɵreplaceMetadata returns cleanly but the DOM
 * doesn't visibly update. Hypothesis: live LView's TView !== oldDef.tView,
 * so recreateMatchingLViews skips it. */

import { chromium } from 'playwright';
import { writeFileSync, readFileSync } from 'node:fs';

const heroHtml =
	'/home/alexkahn/onspark/absolutejs/dealroom/src/frontend/components/hero/hero.component.html';

const log = (...args: unknown[]) => console.log(...args);

const main = async () => {
	const browser = await chromium.launch({ headless: true });
	const ctx = await browser.newContext();
	const page = await ctx.newPage();

	page.on('console', (msg) => {
		const t = msg.text();
		if (
			t.includes('[abs-hmr]') ||
			t.includes('[diag]') ||
			msg.type() === 'error'
		) {
			log(`[browser ${msg.type()}]`, t);
		}
	});
	page.on('pageerror', (err) => {
		log('[browser PAGE ERROR]', err.message);
	});

	const port = process.env.PORT ?? '3000';
	log(`--- step 1: load http://localhost:${port}/`);
	await page.goto(`http://localhost:${port}/`, {
		waitUntil: 'networkidle'
	});

	// Install probe BEFORE editing. The probe wraps the listener so we can
	// snapshot state before/after ɵɵreplaceMetadata and look at LView/tView.
	const installResult = await page.evaluate(() => {
		const w = window as unknown as {
			__angularHmr?: {
				on(ev: string, cb: (d: unknown) => void): void;
			};
			ng?: {
				getComponent: (el: Element) => unknown;
			};
			__diag?: {
				snaps: unknown[];
			};
		};
		w.__diag = { snaps: [] };

		// Find HeroComponent's class via DOM walk
		const findHero = () => {
			const els = document.querySelectorAll('*');
			for (const el of Array.from(els)) {
				const inst = w.ng?.getComponent?.(el) as unknown as {
					constructor: { name: string };
				} | null;
				if (
					inst &&
					inst.constructor &&
					inst.constructor.name === 'HeroComponent'
				) {
					return { inst, el };
				}
			}
			return null;
		};

		const initialHero = findHero();
		if (!initialHero) {
			return { error: 'HeroComponent not found' };
		}
		const HeroCtor = (initialHero.inst as { constructor: unknown })
			.constructor as {
			name: string;
			ɵcmp?: {
				template?: () => void;
				tView?: unknown;
			};
		};

		const initialCmp = HeroCtor.ɵcmp;
		const initialTView = initialCmp?.tView;
		const initialTemplate = initialCmp?.template;
		const initialTemplateText = initialTemplate
			? initialTemplate.toString()
			: '';
		const initialMatch = initialTemplateText.match(
			/Turn Partnerships into/
		);

		// Pull live LView reference
		const heroEl = initialHero.el as HTMLElement & {
			__ngContext__?: number | { lView?: unknown };
		};
		const ctx = heroEl.__ngContext__;
		const ctxKind = typeof ctx;

		// Try to walk the LView via patched data — Angular stores either
		// an LView ID (number) or an LContext object on __ngContext__.
		// LView slots: HOST=0, TVIEW=1
		// We can't access TRACKED_LVIEWS directly from outside core. But we
		// can attempt to walk via getInjector's inner state. Skip for now.

		w.__angularHmr?.on('angular:component-update', (d: unknown) => {
			// This second listener fires AFTER bundle's listener kicks off
			// the ɵɵreplaceMetadata path (async fetch). We poll for state
			// changes over 5 seconds.
			const start = Date.now();
			const snap = (label: string) => {
				const cmp = HeroCtor.ɵcmp;
				const tmpl = cmp?.template;
				const text = tmpl ? tmpl.toString() : '';
				const heroNow = findHero();
				const heroEl2 = heroNow?.el as HTMLElement | undefined;
				const ctx2 = (
					heroEl2 as unknown as {
						__ngContext__?: number;
					}
				)?.__ngContext__;
				return {
					label,
					t: Date.now() - start,
					tViewSameAsInitial: cmp?.tView === initialTView,
					tViewTruthy: !!cmp?.tView,
					templateChanged: text !== initialTemplateText,
					templateHasNew: text.includes(
						'TURN PARTNERSHIPS INTO TEST!'
					),
					templateHasOld: text.includes('Turn Partnerships into'),
					heroElInDom: !!document.contains(heroEl2 as Node),
					sameHeroEl: heroEl2 === heroEl,
					ctxValueKind: typeof ctx2,
					ctxChanged: ctx2 !== ctx,
					innerTextHas:
						(heroEl2 as HTMLElement | undefined)?.innerText?.slice(
							0,
							100
						) ?? null
				};
			};

			let count = 0;
			const interval = setInterval(() => {
				w.__diag!.snaps.push(snap(`tick-${count}`));
				count++;
				if (count >= 12) clearInterval(interval);
			}, 500);
			w.__diag!.snaps.push({
				event: 'received',
				payload: d,
				...snap('immediate')
			});
		});

		return {
			ok: true,
			heroFound: !!initialHero,
			initialTemplateMatchesOld: !!initialMatch,
			initialTViewTruthy: !!initialTView,
			initialTemplateLen: initialTemplateText.length,
			ctxKind
		};
	});
	log('install probe:', installResult);

	log('\n--- step 2: edit hero.component.html');
	const original = readFileSync(heroHtml, 'utf8');
	writeFileSync(
		heroHtml,
		original.replace(
			'Turn Partnerships into',
			'TURN PARTNERSHIPS INTO TEST!'
		)
	);

	// Wait long enough for HMR + post-snapshots
	await new Promise((r) => setTimeout(r, 8000));

	const snaps = await page.evaluate(() => {
		const w = window as unknown as { __diag?: { snaps: unknown[] } };
		return w.__diag?.snaps ?? [];
	});
	log('\n=== HMR LIFECYCLE SNAPS ===');
	for (const snap of snaps) log(JSON.stringify(snap));
	log('=== END SNAPS ===\n');

	// Restore quickly to avoid cascading rebuilds while we read state.
	writeFileSync(heroHtml, original);

	await browser.close();
};

main()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error('FAILED:', err);
		process.exit(1);
	});
