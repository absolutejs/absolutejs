import { describe, expect, test } from 'bun:test';
import {
	createVitalsStore,
	ratingFor,
	vitalBoundaries,
	VITAL_THRESHOLDS
} from '../../../src/core/vitalsStore';
import type { VitalName, VitalReport } from '../../../src/core/vitals';

/* The three things that decide whether this aggregation is worth keeping:
 * that p75 is the statistic (a mean would hide the tail the whole standard
 * is about), that the band tallies are exact rather than approximated by
 * the histogram, and that a store keyed by a client-supplied path cannot
 * grow without bound. */

const sample = (name: VitalName, value: number, route = '/'): VitalReport => ({
	id: `${name}-${value}-${route}`,
	name,
	route,
	value
});

const metricsOf = (store: ReturnType<typeof createVitalsStore>, route = '/') =>
	store.summary().routes.find((entry) => entry.route === route)?.metrics;

describe('the histogram covers each metric on its own scale', () => {
	/* The band tallies are derived by cumulating buckets up to each
	 * threshold, which is only exact because every threshold IS a boundary.
	 * If one were moved inside a bucket, `good` would silently count
	 * samples that are not good — so this pins the coupling the derivation
	 * depends on rather than restating the numbers. */
	test('every Core Web Vitals threshold is a bucket boundary', () => {
		for (const [name, thresholds] of Object.entries(VITAL_THRESHOLDS)) {
			const boundaries = vitalBoundaries(name as VitalName);
			for (const threshold of thresholds)
				expect(boundaries).toContain(threshold);
		}
	});

	/* A single generic bucket set would put every CLS sample in the first
	 * bucket, making its p75 a constant. */
	test('CLS resolves below 1 while LCP resolves in the thousands', () => {
		const store = createVitalsStore();
		for (const value of [0.02, 0.06, 0.12, 0.3])
			store.record(sample('CLS', value));
		for (const value of [800, 1600, 2400, 5200])
			store.record(sample('LCP', value));
		const metrics = metricsOf(store);

		expect(metrics?.CLS?.p75).toBeGreaterThan(0.1);
		expect(metrics?.CLS?.p75).toBeLessThan(0.3);
		expect(metrics?.LCP?.p75).toBeGreaterThan(2400);
		expect(metrics?.LCP?.p75).toBeLessThan(5200);
	});
});

describe('p75, not an average', () => {
	/* The point of the statistic. Nineteen fast loads and one very slow one
	 * is a fast site; three slow ones in ten is not, and a mean would call
	 * the second one fine. */
	test('a slow quarter moves the percentile and would not move a mean much', () => {
		const store = createVitalsStore();
		for (let index = 0; index < 7; index += 1)
			store.record(sample('LCP', 900));
		for (let index = 0; index < 3; index += 1)
			store.record(sample('LCP', 9000));
		const lcp = metricsOf(store)?.LCP;

		/* Mean would be ~3330 — "needs improvement". The 75th percentile is
		 * in the slow tail, which is the assessment Core Web Vitals makes. */
		expect(lcp?.p75).toBeGreaterThan(4000);
		expect(lcp?.rating).toBe('poor');
	});

	test('the rating reported is the rating of the p75', () => {
		const store = createVitalsStore();
		/* Nine good, one poor: the 75th percentile is still good. */
		for (let index = 0; index < 9; index += 1)
			store.record(sample('INP', 90));
		store.record(sample('INP', 1200));
		const inp = metricsOf(store)?.INP;

		expect(inp?.rating).toBe('good');
		expect(inp?.count).toBe(10);
	});

	/* The overflow bucket has no top to interpolate towards, so the honest
	 * answer is the last boundary rather than a number the histogram cannot
	 * support. */
	test('a value past the last bucket reports the last boundary', () => {
		const store = createVitalsStore();
		store.record(sample('LCP', 400_000));
		const boundaries = vitalBoundaries('LCP');

		expect(metricsOf(store)?.LCP?.p75).toBe(
			boundaries[boundaries.length - 1]
		);
	});
});

describe('the band tallies', () => {
	test('count each sample against the published threshold', () => {
		const store = createVitalsStore();
		/* LCP: good at or under 2500, poor past 4000. */
		for (const value of [1000, 2500, 2501, 4000, 4001, 20_000])
			store.record(sample('LCP', value));
		const lcp = metricsOf(store)?.LCP;

		expect(lcp).toMatchObject({
			count: 6,
			good: 2,
			needsImprovement: 2,
			poor: 2
		});
	});

	/* The rating the browser sends is not consulted: a client can send any
	 * rating it likes, and a store that believed it would report whatever a
	 * caller asserted. */
	test('ignore the rating the client claimed', () => {
		const store = createVitalsStore();
		store.record({ ...sample('LCP', 9000), rating: 'good' });

		expect(metricsOf(store)?.LCP?.poor).toBe(1);
		expect(ratingFor('LCP', 9000)).toBe('poor');
	});
});

describe('the store is bounded', () => {
	/* The route is a client-supplied `location.pathname`. Without the cap,
	 * ten metrics per batch at the endpoint's own 60/min is 600 new routes
	 * a minute from one address, and the aggregation becomes a
	 * memory-exhaustion vector — the same hazard the rate limiter's key
	 * store has, one layer up. */
	test('rotating routes cannot grow it past the cap', () => {
		const store = createVitalsStore({ maxRoutes: 25 });
		for (let index = 0; index < 5000; index += 1)
			store.record(sample('LCP', 1000, `/p/${index}`));
		const summary = store.summary();

		expect(summary.routes.length).toBeLessThanOrEqual(25);
		expect(summary.truncated).toBe(true);
		/* Every sample is still counted, so the total does not lie about
		 * how much was measured even though the listing is partial. */
		expect(summary.sampleCount).toBe(5000);
	});

	/* Eviction takes the route that has gone longest without a report, so a
	 * route still receiving traffic keeps its history. Without the
	 * delete-then-set on each report, `/busy` below would be dropped as the
	 * oldest insert and lose every sample before the last. */
	test('the least recently reporting route is evicted, not the first seen', () => {
		const store = createVitalsStore({ maxRoutes: 2 });
		store.record(sample('LCP', 1000, '/busy'));
		store.record(sample('LCP', 1000, '/idle'));
		store.record(sample('LCP', 1000, '/busy'));
		store.record(sample('LCP', 1000, '/newcomer'));
		const routes = store.summary().routes.map((entry) => entry.route);

		expect(routes).toContain('/busy');
		expect(routes).not.toContain('/idle');
	});

	test('a report with a nonsense value is not recorded', () => {
		const store = createVitalsStore();
		store.record(sample('LCP', Number.NaN));
		store.record(sample('LCP', -1));
		store.record(sample('LCP', Number.POSITIVE_INFINITY));

		expect(store.summary().sampleCount).toBe(0);
	});

	test('routes are kept apart', () => {
		const store = createVitalsStore();
		store.record(sample('LCP', 800, '/fast'));
		store.record(sample('LCP', 9000, '/slow'));

		expect(metricsOf(store, '/fast')?.LCP?.rating).toBe('good');
		expect(metricsOf(store, '/slow')?.LCP?.rating).toBe('poor');
	});

	/* `since` dates the window the numbers cover, so clearing restarts it
	 * rather than dating an empty store to before the samples it dropped. */
	test('clear empties the store and restarts the window', () => {
		const store = createVitalsStore();
		store.record(sample('LCP', 800));
		store.clear();
		const after = store.summary();

		expect(after.routes).toEqual([]);
		expect(after.sampleCount).toBe(0);
		expect(Date.parse(after.since)).toBeGreaterThan(0);
	});
});
