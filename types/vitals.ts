import type { VitalName } from '../src/core/vitals';

export type VitalRating = 'good' | 'needs-improvement' | 'poor';

export type VitalsMetricSummary = {
	count: number;
	/** Samples in each Core Web Vitals band, derived from the value against
	 *  the published threshold rather than from the `rating` the browser
	 *  sent — a client can send any rating it likes. */
	good: number;
	needsImprovement: number;
	/** The 75th percentile, which is the statistic Core Web Vitals is
	 *  assessed at. Estimated from a fixed histogram, so it is accurate to
	 *  the width of the bucket it lands in, and reported as the top
	 *  boundary when it lands past the last one. */
	p75: number;
	poor: number;
	/** The band `p75` falls in: the assessment for this route and metric. */
	rating: VitalRating;
};

export type VitalsRouteSummary = {
	metrics: Partial<Record<VitalName, VitalsMetricSummary>>;
	route: string;
};

export type VitalsSummary = {
	routes: VitalsRouteSummary[];
	/** Samples taken in, across every route — including routes since
	 *  evicted, so this does not have to equal the sum of the counts
	 *  below. */
	sampleCount: number;
	/** When this process started aggregating. The numbers are this
	 *  process's, since it started: nothing is persisted and nothing is
	 *  shared between instances. */
	since: string;
	/** True once a route has been evicted for the cap, so the routes listed
	 *  are not every route that reported. */
	truncated: boolean;
};

export type ResolvedVitalsSummary = {
	maxRoutes?: number;
	path: string;
};

export type VitalsSummaryConfig = {
	/** Where the summary is served. Default `/__absolute/vitals/summary`. */
	path?: string;
	/** Most routes held at once. Default 200. The oldest-reporting route is
	 *  evicted, which is what keeps a store keyed by a client-supplied path
	 *  from growing without bound. */
	maxRoutes?: number;
};
