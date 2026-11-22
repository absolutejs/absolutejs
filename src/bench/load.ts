/* The request loop behind `absolute bench`'s throughput numbers.
 *
 * Deliberately dependency-free rather than wrapping a load generator:
 * one more install for a loop is a poor trade, and the numbers that
 * matter here are relative to a baseline taken the same way on the same
 * machine, not absolute records.
 *
 * What it does do properly:
 *
 *   - a warmup phase whose samples are thrown away, because the first
 *     requests pay for JIT, module graph instantiation and a cold page
 *     cache, and including them makes a fast server look slow;
 *   - a fixed measured window rather than a fixed request count, so a
 *     slow server is not given proportionally longer to warm up;
 *   - fixed concurrency, since one request at a time measures latency
 *     and says nothing about throughput;
 *   - a non-2xx counted as an error rather than as a fast response. A
 *     server returning 500 in 1ms must never read as the fastest. */

import type { ThroughputSample } from './metrics';

export type LoadOptions = {
	/** Requests in flight at once. */
	concurrency: number;
	/** Measured window in milliseconds. */
	durationMs: number;
	/** Discarded window in milliseconds. */
	warmupMs: number;
};

const requestOnce = async (url: string) => {
	const started = performance.now();
	try {
		const response = await fetch(url, {
			headers: { accept: 'text/html' }
		});
		/* The body has to be drained, or the measurement stops at the
		 * headers and a streaming render looks instant. */
		await response.arrayBuffer();

		return { ms: performance.now() - started, ok: response.ok };
	} catch {
		return { ms: performance.now() - started, ok: false };
	}
};

/* One worker, looping until the deadline. Samples are collected only
 * when `collect` is given, which is how the warmup window is discarded
 * without a second code path. */
const worker = async (
	url: string,
	until: number,
	collect: ThroughputSample[] | null
) => {
	while (performance.now() < until) {
		/* eslint-disable-next-line no-await-in-loop -- a worker is
		 * sequential by design; concurrency comes from running several. */
		const sample = await requestOnce(url);
		collect?.push(sample);
	}
};

/** Hit `url` and report what came back. The warmup runs first and its
 *  samples are dropped. */
export const measureThroughput = async (
	url: string,
	{ concurrency, durationMs, warmupMs }: LoadOptions
) => {
	if (warmupMs > 0) {
		const warmUntil = performance.now() + warmupMs;
		await Promise.all(
			Array.from({ length: concurrency }, () =>
				worker(url, warmUntil, null)
			)
		);
	}

	const samples: ThroughputSample[] = [];
	const startedAt = performance.now();
	const until = startedAt + durationMs;
	await Promise.all(
		Array.from({ length: concurrency }, () => worker(url, until, samples))
	);

	return { samples, windowMs: performance.now() - startedAt };
};
