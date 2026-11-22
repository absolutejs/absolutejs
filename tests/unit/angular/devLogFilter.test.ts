import { describe, expect, test } from 'bun:test';
import {
	shouldSuppressAngularLog,
	withSuppressedAngularDevLogs
} from '../../../src/angular/ssrRender';

/* Angular logs "Angular is running in development mode." on every
 * `bootstrapApplication`, which on a server is once per request, so it
 * has to be filtered.
 *
 * The filter used to be installed and removed around each render. Under
 * concurrency that leaks: each render captures whatever is installed when
 * IT starts and reinstalls that when IT finishes, so the last render to
 * finish wins and a wrapper is left behind. One accumulates per round of
 * concurrent renders, and every `console.log` in the process then walks
 * the chain. Measured before the fix: after 60 rounds — 480 renders —
 * 20,000 `console.log` calls went from 0.3ms to 79.7ms, and a message
 * containing the filtered phrase was swallowed for the life of the
 * process.
 *
 * Nothing here intercepts `console.log`. An earlier version of this file
 * installed a sink and asserted on what reached it, which passed when run
 * alone and failed in the shared unit run: the filter installs itself on
 * first use and closes over the `console.log` it finds then, so that
 * assertion only held if this file happened to be the first thing in the
 * process to touch the module. Asserting on the predicate and on the
 * installed wrapper's identity is order-independent. */

const NOTICE = 'Angular is running in development mode.';

/* Renders that START in order and FINISH in the same order, which is the
 * case the old shape got wrong: the last to finish had captured the
 * wrapper installed by the one before it. */
const concurrentRound = () =>
	Promise.all(
		[1, 2, 3, 4, 5, 6, 7, 8].map((ms) =>
			withSuppressedAngularDevLogs(() => Bun.sleep(ms))
		)
	);

describe('the Angular dev-log filter', () => {
	test('suppresses Angular’s notice while a render is in flight', async () => {
		const duringRender = await withSuppressedAngularDevLogs(async () => {
			await Bun.sleep(1);

			return shouldSuppressAngularLog([NOTICE]);
		});

		expect(duringRender).toBe(true);
	}, 30_000);

	/* Only while rendering. A permanently installed content filter would
	 * swallow the same phrase from application code forever, which is the
	 * other way to get this wrong. */
	test('leaves the notice alone outside a render', () => {
		expect(shouldSuppressAngularLog([NOTICE])).toBe(false);
	});

	/* Narrowed to Angular's own wording. An application line that happens
	 * to share the phrase is not the framework's to hide. */
	test('does not suppress an unrelated message containing the phrase', async () => {
		const duringRender = await withSuppressedAngularDevLogs(async () => {
			await Bun.sleep(1);

			return shouldSuppressAngularLog([
				'starting worker in development mode'
			]);
		});

		expect(duringRender).toBe(false);
	}, 30_000);

	test('ignores a non-string first argument', async () => {
		const duringRender = await withSuppressedAngularDevLogs(() =>
			Promise.resolve(shouldSuppressAngularLog([{ notice: NOTICE }]))
		);

		expect(duringRender).toBe(false);
	});

	test('a render that throws still stops suppressing', async () => {
		await expect(
			withSuppressedAngularDevLogs(() => {
				throw new Error('render failed');
			})
		).rejects.toThrow('render failed');

		expect(shouldSuppressAngularLog([NOTICE])).toBe(false);
	});

	/* Nested renders — a page containing an Angular island — must not
	 * un-suppress when the inner one finishes. */
	test('stays suppressed until the outermost render finishes', async () => {
		const afterInner = await withSuppressedAngularDevLogs(async () => {
			await withSuppressedAngularDevLogs(() => Bun.sleep(1));

			return shouldSuppressAngularLog([NOTICE]);
		});

		expect(afterInner).toBe(true);
		expect(shouldSuppressAngularLog([NOTICE])).toBe(false);
	}, 30_000);

	test('a round of concurrent renders leaves nothing suppressed', async () => {
		await concurrentRound();

		expect(shouldSuppressAngularLog([NOTICE])).toBe(false);
	}, 30_000);

	/* The symptom that made this worth fixing: every `console.log` in the
	 * process walked a chain that grew by one wrapper per round, so
	 * logging got slower without bound — 20,000 calls went from 0.3ms to
	 * 79.7ms over 60 rounds.
	 *
	 * Asserted by identity rather than by timing. A wall-clock bound loose
	 * enough to survive a shared CI box turned out to pass against the
	 * broken code, which is worse than no test: counting distinct
	 * installations catches the accumulation exactly. */
	test('installs exactly one wrapper however many rounds run', async () => {
		/* One round first, so the count below cannot include the one-off
		 * install this file may itself trigger. */
		await concurrentRound();
		const seenIdentities = new Set<unknown>();
		for (let round = 0; round < 20; round += 1) {
			/* eslint-disable-next-line no-await-in-loop -- the leak needed
			 * completed rounds, so these are sequential on purpose. */
			await concurrentRound();
			seenIdentities.add(console.log);
		}

		expect(seenIdentities.size).toBe(1);
	}, 90_000);
});
