/* In-process aggregation of the web vitals the built-in endpoint accepts.
 *
 * Why aggregate at all, when `onVital()` already hands over every metric:
 * because nothing registered a handler. Before this, turning `vitals` on
 * bundled a reporter into every client bundle, posted a batch per page load,
 * validated it against a schema and then discarded it — the collection
 * shipped and the data did not survive the request. A default that measures
 * and throws the measurement away is worse than no measurement, because it
 * looks like one.
 *
 * Histograms rather than raw values, for two reasons. Core Web Vitals is
 * assessed at the 75th percentile, so a mean is the wrong statistic — the
 * tail is the whole point — and keeping every value to compute an exact p75
 * means a store that grows with traffic. A fixed histogram is bounded per
 * route, and its error is the width of the bucket the answer lands in,
 * which is narrowest around the thresholds where the assessment turns.
 *
 * Bounded by route, because the route is a client-supplied
 * `location.pathname` of up to 2048 characters. The rate limiter caps
 * distinct client keys; this caps distinct routes, and one client can mint
 * many — ten metrics per batch at sixty batches a minute is six hundred
 * routes a minute from a single address. Honest traffic hits the same wall
 * more slowly: `/users/1` and `/users/2` are distinct paths here, so a site
 * with ids in its paths will evict. `truncated` says so rather than
 * presenting a partial listing as complete, and `onVital()` remains the way
 * to keep every sample exactly. */

import type { VitalsMetricSummary, VitalsSummary } from '../../types/vitals';
import type { VitalName, VitalReport } from './vitals';

const DEFAULT_MAX_ROUTES = 200;
const P75 = 0.75;

/* Per-metric bucket boundaries: inclusive upper bounds, ascending, with an
 * implicit overflow bucket past the last. A single generic set would be
 * useless — CLS is a unitless score under 1 while LCP is milliseconds in
 * the thousands, so every CLS sample would land in the first bucket.
 *
 * Each metric's two thresholds MUST appear among its boundaries: the band
 * tallies in the summary are derived by cumulating buckets up to them, so a
 * threshold that fell inside a bucket would be counted on the wrong side.
 * tests/unit/core/vitalsStore.test.ts pins that. */
const BOUNDARIES: Record<VitalName, readonly number[]> = {
	CLS: [0.01, 0.025, 0.05, 0.075, 0.1, 0.15, 0.2, 0.25, 0.35, 0.5, 0.75, 1],
	FCP: [300, 600, 900, 1200, 1500, 1800, 2200, 2600, 3000, 4000, 5000, 8000],
	INP: [50, 100, 150, 200, 250, 300, 400, 500, 700, 1000, 1500, 2000],
	LCP: [
		500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 5000, 6000, 8000, 10_000,
		15_000
	],
	TTFB: [100, 200, 400, 600, 800, 1100, 1400, 1800, 2500, 4000, 6000, 10_000]
};

/* The published Core Web Vitals thresholds: at or under the first is good,
 * at or under the second needs improvement, past it is poor. */
export const VITAL_THRESHOLDS: Record<VitalName, readonly [number, number]> = {
	CLS: [0.1, 0.25],
	FCP: [1800, 3000],
	INP: [200, 500],
	LCP: [2500, 4000],
	TTFB: [800, 1800]
};

export const ratingFor = (name: VitalName, value: number) => {
	const [good, poor] = VITAL_THRESHOLDS[name];
	if (value <= good) return 'good';

	return value <= poor ? 'needs-improvement' : 'poor';
};

export const vitalBoundaries = (name: VitalName) => BOUNDARIES[name];

const bucketFor = (boundaries: readonly number[], value: number) => {
	for (const [index, bound] of boundaries.entries())
		if (value <= bound) return index;

	/* The overflow bucket. */
	return boundaries.length;
};

/** The 75th percentile, interpolated inside the bucket it falls in. A value
 *  past the last boundary is reported as that boundary: the overflow bucket
 *  has no top to interpolate towards, and naming a number beyond the
 *  histogram would be inventing precision it does not have. */
const percentile = (boundaries: readonly number[], counts: number[]) => {
	const last = boundaries[boundaries.length - 1] ?? 0;
	const total = counts.reduce((sum, count) => sum + count, 0);
	if (total === 0) return 0;
	const target = total * P75;
	const cumulative: number[] = [];
	counts.reduce((sum, count) => {
		const reached = sum + count;
		cumulative.push(reached);

		return reached;
	}, 0);
	const index = cumulative.findIndex((reached) => reached >= target);
	const upper = boundaries[index];
	/* Either nothing reached the target or the answer is in the overflow
	 * bucket, which has no top boundary to interpolate towards. */
	if (index < 0 || upper === undefined) return last;
	const count = counts[index] ?? 0;
	/* Samples below this bucket. An empty bucket can never be the one that
	 * reaches the target, so this division is safe. */
	const below = (cumulative[index] ?? 0) - count;
	const lower = index === 0 ? 0 : (boundaries[index - 1] ?? 0);

	return lower + (upper - lower) * ((target - below) / count);
};

/** Samples at or under `threshold`, which is exact because every threshold
 *  is a bucket boundary. */
const countUpTo = (
	boundaries: readonly number[],
	counts: number[],
	threshold: number
) => {
	let sum = 0;
	/* Ascending, so the first boundary past the threshold ends it. */
	for (const [index, bound] of boundaries.entries()) {
		if (bound > threshold) break;
		sum += counts[index] ?? 0;
	}

	return sum;
};

const summarize = (name: VitalName, counts: number[]): VitalsMetricSummary => {
	const boundaries = BOUNDARIES[name];
	const [good, poor] = VITAL_THRESHOLDS[name];
	const total = counts.reduce((sum, count) => sum + count, 0);
	const goodCount = countUpTo(boundaries, counts, good);
	const okCount = countUpTo(boundaries, counts, poor);
	const p75 = percentile(boundaries, counts);

	return {
		count: total,
		good: goodCount,
		needsImprovement: okCount - goodCount,
		p75: Math.round(p75 * 1000) / 1000,
		poor: total - okCount,
		rating: ratingFor(name, p75)
	};
};

export const createVitalsStore = ({
	maxRoutes = DEFAULT_MAX_ROUTES
}: { maxRoutes?: number } = {}) => {
	/* Insertion-ordered, and re-inserted on each report, so eviction takes
	 * the route that has gone longest without one rather than the one
	 * recorded first — the same reason the rate limiter's store does it. */
	const routes = new Map<string, Map<VitalName, number[]>>();
	let since = new Date().toISOString();
	let sampleCount = 0;
	let truncated = false;

	return {
		clear: () => {
			routes.clear();
			sampleCount = 0;
			truncated = false;
			/* `since` describes the window the numbers cover, so a clear
			 * restarts it — otherwise the summary would date an empty store
			 * to before the samples it no longer holds. */
			since = new Date().toISOString();
		},
		record: ({ name, route, value }: VitalReport) => {
			if (!Number.isFinite(value) || value < 0) return;
			const existing = routes.get(route);
			const metrics = existing ?? new Map<VitalName, number[]>();
			/* Delete before set, so a route that is still reporting moves to
			 * the back of the queue instead of keeping its first position. */
			if (existing !== undefined) routes.delete(route);
			routes.set(route, metrics);
			if (routes.size > maxRoutes) {
				const oldest = routes.keys().next().value;
				if (oldest !== undefined) routes.delete(oldest);
				truncated = true;
			}

			const boundaries = BOUNDARIES[name];
			const counts =
				metrics.get(name) ??
				new Array<number>(boundaries.length + 1).fill(0);
			metrics.set(name, counts);
			const index = bucketFor(boundaries, value);
			counts[index] = (counts[index] ?? 0) + 1;
			sampleCount += 1;
		},
		summary: (): VitalsSummary => ({
			routes: [...routes.entries()].map(([route, metrics]) => ({
				metrics: Object.fromEntries(
					[...metrics.entries()].map(([name, counts]) => [
						name,
						summarize(name, counts)
					])
				),
				route
			})),
			sampleCount,
			since,
			truncated
		})
	};
};

export type VitalsStore = ReturnType<typeof createVitalsStore>;
