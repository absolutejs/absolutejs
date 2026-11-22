import { afterAll, beforeEach, describe, expect, test } from 'bun:test';

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
 * Ordering is load-bearing in this file. The filter installs itself on
 * first use and closes over the `console.log` it finds then, so the sink
 * has to be in place BEFORE the module is imported — otherwise the
 * wrapper delegates to the real console and nothing here can observe
 * what survived. */

const realLog = console.log;
const lines: unknown[] = [];
console.log = (...args: unknown[]) => {
	lines.push(args[0]);
};

const { withSuppressedAngularDevLogs } =
	await import('../../../src/angular/ssrRender');

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

beforeEach(() => {
	lines.length = 0;
});

afterAll(() => {
	console.log = realLog;
});

describe('the Angular dev-log filter', () => {
	test('suppresses Angular’s notice while a render is in flight', async () => {
		await withSuppressedAngularDevLogs(async () => {
			console.log(NOTICE);
			await Bun.sleep(1);
		});

		expect(lines).toEqual([]);
	}, 30_000);

	/* Only while rendering. A permanently installed content filter would
	 * swallow the same phrase from application code forever, which is the
	 * other way to get this wrong. */
	test('leaves the notice alone outside a render', () => {
		console.log(NOTICE);

		expect(lines).toEqual([NOTICE]);
	});

	/* Narrowed to Angular's own wording. An application line that happens
	 * to share the phrase is not the framework's to hide. */
	test('does not swallow an unrelated message containing the phrase', async () => {
		await withSuppressedAngularDevLogs(async () => {
			console.log('starting worker in development mode');
			await Bun.sleep(1);
		});

		expect(lines).toEqual(['starting worker in development mode']);
	}, 30_000);

	test('a render that throws still stops suppressing', async () => {
		await expect(
			withSuppressedAngularDevLogs(() => {
				throw new Error('render failed');
			})
		).rejects.toThrow('render failed');

		console.log(NOTICE);

		expect(lines).toEqual([NOTICE]);
	});

	/* Nested renders — a page containing an Angular island — must not
	 * un-suppress when the inner one finishes. */
	test('stays suppressed until the outermost render finishes', async () => {
		await withSuppressedAngularDevLogs(async () => {
			await withSuppressedAngularDevLogs(() => Bun.sleep(1));
			console.log(NOTICE);
		});

		expect(lines).toEqual([]);
	}, 30_000);

	test('does not nest a wrapper per concurrent render', async () => {
		await concurrentRound();
		const afterOne = console.log;
		await concurrentRound();
		await concurrentRound();

		/* Whatever is installed after the first round is still exactly
		 * what is installed after two more. The old shape left one more
		 * wrapper each time. */
		expect(console.log).toBe(afterOne);
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
