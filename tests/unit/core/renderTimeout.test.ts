import { afterEach, describe, expect, test } from 'bun:test';
import {
	createRenderAbort,
	DEFAULT_RENDER_TIMEOUT_MS,
	renderTimeoutMs,
	setRenderTimeout
} from '../../../src/core/renderTimeout';

/* A render that never finishes never answered. Measured with React and a
 * Suspense boundary that never resolves: the stream produced its shell
 * and then nothing, for as long as anyone waited — no error, no close.
 * The only thing that ended it was Bun's HTTP idleTimeout, 240s here,
 * which reaps the socket WITHOUT an error, so the request died in silence
 * four minutes later.
 *
 * Aborting is much better, because React answers it properly: measured,
 * an abort finished the stream 16ms later, called onError once, and sent
 * a document containing the shell AND the pending boundary's fallback. */

afterEach(() => {
	setRenderTimeout(undefined);
});

describe('the budget', () => {
	test('defaults to thirty seconds', () => {
		expect(renderTimeoutMs()).toBe(DEFAULT_RENDER_TIMEOUT_MS);
	});

	test('a configured value wins', () => {
		setRenderTimeout(5_000);

		expect(renderTimeoutMs()).toBe(5_000);
	});

	/* `false` is the old behaviour, kept reachable: a project that
	 * genuinely renders for minutes should be able to say so rather than
	 * discovering a cut-off page in production. */
	test('false means unbounded', () => {
		setRenderTimeout(false);

		expect(renderTimeoutMs()).toBeUndefined();
	});

	test('a nonsense value is treated as unbounded, not as zero', () => {
		setRenderTimeout(0);

		expect(renderTimeoutMs()).toBeUndefined();
	});
});

describe('the abort it hands a renderer', () => {
	test('none at all when rendering is unbounded', () => {
		setRenderTimeout(false);

		expect(createRenderAbort()).toBeUndefined();
	});

	/* Passing a signal that never fires would look the same from the
	 * outside and cost a timer per render. */
	test('a signal that is not yet aborted', () => {
		setRenderTimeout(10_000);

		expect(createRenderAbort()?.signal.aborted).toBe(false);
	});

	test('aborts once the budget passes', async () => {
		setRenderTimeout(20);
		const abort = createRenderAbort();
		await new Promise((resolve) => setTimeout(resolve, 60));

		expect(abort?.signal.aborted).toBe(true);
		expect(abort?.signal.reason).toBeInstanceOf(Error);
	});

	/* The budget covers the render, not the transfer: once a stream has
	 * finished there is nothing left to cut off, and leaving the timer
	 * armed would hold one per in-flight page. */
	test('done() stops it from aborting afterwards', async () => {
		setRenderTimeout(20);
		const abort = createRenderAbort();
		abort?.done();
		await new Promise((resolve) => setTimeout(resolve, 60));

		expect(abort?.signal.aborted).toBe(false);
	});
});
