import { describe, expect, test } from 'bun:test';
import {
	compareRecords,
	frameworkOf,
	latencyPercentile,
	median,
	sizesByFramework,
	summarizeThroughput,
	type BenchRecord
} from '../../../src/bench/metrics';

/* Two kinds of measurement share one record and they are not
 * interchangeable. Bundle sizes are deterministic, so a change is a real
 * change. Build time and throughput move with CPU contention and thermal
 * state. Gating a wall clock as if it were a byte count is how a
 * benchmark gate becomes the flaky job everyone reruns until it passes —
 * which is worse than not having one, so the tolerances differ by an
 * order of magnitude and these tests pin that. */

const KB = 1024;

describe('latencyPercentile', () => {
	/* Nearest-rank, and easy to get subtly wrong. */
	test.each([
		[50, 3],
		[90, 5],
		[99, 5],
		[100, 5]
	])('p%i of 1..5 is %i', (rank, expected) => {
		expect(latencyPercentile([5, 1, 4, 2, 3], rank)).toBe(expected);
	});

	test('sorts before ranking rather than trusting the order given', () => {
		expect(latencyPercentile([9, 1], 50)).toBe(1);
	});

	/* Null, not 0 — an empty set has no latency, and 0 would read as
	 * "instant", which is the most flattering possible lie. */
	test('an empty set has no percentile', () => {
		expect(latencyPercentile([], 50)).toBeNull();
		expect(median([])).toBeNull();
	});
});

describe('frameworkOf', () => {
	/* Read off the asset's own path. The manifest key is no use:
	 * `SpaShell` says nothing about being Vue. */
	test.each([
		['/Users/me/app/build/svelte/server/pages/Home.js', 'svelte'],
		['/.absolutejs/generated/vue/indexes/SpaShell.js', 'vue'],
		['/build/angular/example/angular/pages/x.js', 'angular'],
		['/build/react/vendor/chunk.js', 'react']
	])('%s → %s', (path, expected) => {
		expect(frameworkOf(path)).toBe(expected);
	});

	test('a shared chunk belongs to no framework', () => {
		expect(frameworkOf('/chunk-g1m5mt8e.js')).toBeNull();
	});
});

describe('sizesByFramework', () => {
	const manifest: Record<string, string> = {
		Chunk: '/chunk-shared.js',
		Home: '/build/svelte/server/pages/Home.js',
		HomeIndex: '/build/svelte/client/Home.js',
		Spa: '/build/vue/server/Spa.js'
	};
	const sizeOf = (path: string) => (path.includes('shared') ? 500 : 100);

	test('sums per framework', () => {
		expect(sizesByFramework({ manifest, sizeOf })).toEqual({
			shared: 500,
			svelte: 200,
			vue: 100
		});
	});

	/* `shared` is not a gap. A chunk two frameworks import belongs to
	 * neither, and charging it to one makes that framework look worse for
	 * code it does not own. */
	test('unattributable assets land under shared, not dropped', () => {
		const totals = sizesByFramework({ manifest, sizeOf });
		const sum = Object.values(totals).reduce((carry, n) => carry + n, 0);

		expect(sum).toBe(800);
	});
});

describe('summarizeThroughput', () => {
	/* A server returning 500 in 1ms must never read as the fastest thing
	 * measured, so failures are counted and kept out of the latencies. */
	test('a failed request is an error, not a fast response', () => {
		const result = summarizeThroughput(
			[
				{ ms: 1, ok: false },
				{ ms: 10, ok: true },
				{ ms: 20, ok: true }
			],
			1000
		);

		expect(result).toMatchObject({ errors: 1, p50: 10, requests: 3 });
		/* And rps counts only what was actually served. */
		expect(result.rps).toBe(2);
	});

	test('a window of zero reports no rate rather than dividing by zero', () => {
		const result = summarizeThroughput([{ ms: 5, ok: true }], 0);

		expect(result.rps).toBe(0);
	});
});

describe('compareRecords', () => {
	const baseline: BenchRecord = {
		buildMs: 1000,
		recordedAt: '2026-01-01T00:00:00.000Z',
		sizes: { react: 100 * KB, shared: 500 * KB },
		throughput: {
			react: { errors: 0, p50: 1, p99: 2, requests: 100, rps: 1000 }
		}
	};

	const withSizes = (sizes: Record<string, number>): BenchRecord => ({
		recordedAt: '2026-02-01T00:00:00.000Z',
		sizes
	});

	test('nothing to report when nothing moved', () => {
		expect(compareRecords(baseline, { ...baseline })).toEqual([]);
	});

	/* An improvement is not a finding. A build that got faster should not
	 * need a human to dismiss a warning about it. */
	test('improvements are not reported', () => {
		const better: BenchRecord = {
			...baseline,
			buildMs: 500,
			sizes: { react: 50 * KB, shared: 250 * KB },
			throughput: {
				react: { errors: 0, p50: 1, p99: 2, requests: 100, rps: 5000 }
			}
		};

		expect(compareRecords(baseline, better)).toEqual([]);
	});

	test('byte growth past the tight tolerance is a regression', () => {
		const grown = withSizes({ react: 110 * KB, shared: 500 * KB });
		const found = compareRecords(baseline, grown, { sizeTolerance: 1.05 });

		expect(found.map((entry) => entry.subject)).toEqual(['react']);
		expect(found[0]?.kind).toBe('size');
	});

	/* Deterministic measurements get a tight tolerance; noise does not
	 * enter into it. */
	test('byte growth inside the tolerance is not', () => {
		const grown = withSizes({ react: 103 * KB, shared: 500 * KB });

		expect(
			compareRecords(baseline, grown, { sizeTolerance: 1.05 })
		).toEqual([]);
	});

	test('a build that got slower past the loose tolerance is a regression', () => {
		const slower: BenchRecord = { ...baseline, buildMs: 1300 };
		const found = compareRecords(baseline, slower, { timeTolerance: 1.25 });

		expect(found.map((entry) => entry.kind)).toEqual(['time']);
	});

	test('a build 20% slower is within the timing tolerance', () => {
		const slower: BenchRecord = { ...baseline, buildMs: 1200 };

		expect(
			compareRecords(baseline, slower, { timeTolerance: 1.25 })
		).toEqual([]);
	});

	/* Throughput regresses by going DOWN, so its comparison is inverted.
	 * Getting this backwards would make the gate fire on every
	 * improvement and never on a regression. */
	test('throughput falling past the tolerance is a regression', () => {
		const slower: BenchRecord = {
			...baseline,
			throughput: {
				react: { errors: 0, p50: 2, p99: 4, requests: 50, rps: 700 }
			}
		};
		const found = compareRecords(baseline, slower, { timeTolerance: 1.25 });

		expect(found.map((entry) => entry.kind)).toEqual(['rps']);
		expect(found[0]).toMatchObject({ baseline: 1000, current: 700 });
	});

	test('a page the baseline does not know is not judged', () => {
		const added: BenchRecord = {
			...baseline,
			throughput: {
				...baseline.throughput,
				vue: { errors: 0, p50: 1, p99: 1, requests: 10, rps: 1 }
			}
		};

		expect(compareRecords(baseline, added)).toEqual([]);
	});

	/* A framework the build no longer produces is a change to report
	 * elsewhere, not a size regression of zero bytes. */
	test('a framework that disappeared is not a size regression', () => {
		const fewer = withSizes({ shared: 500 * KB });

		expect(compareRecords(baseline, fewer)).toEqual([]);
	});
});
