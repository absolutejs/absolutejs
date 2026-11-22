/* The arithmetic behind `absolute bench`, kept pure so the numbers can be
 * checked without starting a server.
 *
 * Two kinds of measurement live in one record and they are NOT
 * interchangeable:
 *
 *   Deterministic — bundle sizes. The same input gives the same bytes on
 *   any machine, so a change is a real change and a tight tolerance is
 *   right.
 *
 *   Timed — build duration and render throughput. These move with CPU
 *   contention, thermal state and what else is running. A single sample
 *   is close to meaningless, so they are taken repeatedly and reported as
 *   a median, with a loose tolerance. Gating a wall clock as if it were a
 *   byte count is how a benchmark gate becomes the flaky job everyone
 *   reruns until it passes, which is worse than not having one. */

const PERCENT = 100;

/** Nearest-rank percentile over unsorted samples. Returns null for an
 *  empty set rather than 0, which would read as "instant". */
export const latencyPercentile = (samples: readonly number[], rank: number) => {
	if (samples.length === 0) return null;
	const sorted = [...samples].sort((left, right) => left - right);
	const index = Math.min(
		sorted.length - 1,
		Math.max(0, Math.ceil((rank / PERCENT) * sorted.length) - 1)
	);

	return sorted[index] ?? null;
};

export const median = (samples: readonly number[]) =>
	latencyPercentile(samples, 50);

export type FrameworkSizes = Record<string, number>;

const FRAMEWORK_SEGMENTS = [
	'angular',
	'ember',
	'html',
	'htmx',
	'react',
	'svelte',
	'vue'
];

/** Which framework an asset belongs to, read off its own path.
 *
 *  Every build output lands under a directory named for its framework —
 *  `build/svelte/server/pages/…`, `.absolutejs/generated/vue/indexes/…` —
 *  which is a more reliable signal than the manifest key, where
 *  `SpaShell` says nothing about being Vue. */
export const frameworkOf = (assetPath: string) =>
	FRAMEWORK_SEGMENTS.find((name) => assetPath.includes(`/${name}/`)) ?? null;

export type SizesByFrameworkInput = {
	/** Manifest key to asset path. */
	manifest: Record<string, string>;
	/** Bytes for an asset path, or 0 when it cannot be read. */
	sizeOf: (assetPath: string) => number;
};

/** Bytes per framework, with everything unattributable under `shared`.
 *
 *  `shared` is not a gap: a chunk two frameworks both import belongs to
 *  neither, and charging it to one would make that framework look worse
 *  for code it does not own. On this repository's example app it is the
 *  585 KB of `/chunk-*.js`. */
export const sizesByFramework = ({
	manifest,
	sizeOf
}: SizesByFrameworkInput) => {
	const totals: FrameworkSizes = {};
	for (const assetPath of Object.values(manifest)) {
		const framework = frameworkOf(assetPath) ?? 'shared';
		totals[framework] = (totals[framework] ?? 0) + sizeOf(assetPath);
	}

	return totals;
};

export type ThroughputSample = {
	/** Latency in milliseconds. */
	ms: number;
	ok: boolean;
};

export type ThroughputResult = {
	errors: number;
	p50: number | null;
	p99: number | null;
	requests: number;
	/** Requests per second over the measured window. */
	rps: number;
};

const MS_PER_SECOND = 1000;

export const summarizeThroughput = (
	samples: readonly ThroughputSample[],
	windowMs: number
): ThroughputResult => {
	const served = samples.filter((sample) => sample.ok);
	const latencies = served.map((sample) => sample.ms);

	return {
		errors: samples.length - served.length,
		p50: latencyPercentile(latencies, 50),
		p99: latencyPercentile(latencies, 99),
		requests: samples.length,
		rps:
			windowMs > 0
				? Number(
						((served.length / windowMs) * MS_PER_SECOND).toFixed(1)
					)
				: 0
	};
};

export type BenchRecord = {
	/** Median wall-clock of the build, in ms, across the runs taken. */
	buildMs?: number;
	/** Per-framework build time from the build's own trace, in ms. */
	buildMsByFramework?: Record<string, number>;
	/** ISO timestamp, so a baseline says when it was taken. */
	recordedAt: string;
	/** Bytes per framework, plus `shared`. */
	sizes: FrameworkSizes;
	/** Throughput per measured page, keyed by its label. */
	throughput?: Record<string, ThroughputResult>;
	/** The package version measured. A baseline from another version is
	 *  still comparable, but it is worth saying which. */
	version?: string;
};

export type Regression = {
	/** What it was, in the baseline. */
	baseline: number;
	/** What it is now. */
	current: number;
	/** The ratio allowed before this counted. */
	tolerance: number;
	/** `size` is deterministic; `time` and `rps` are not. */
	kind: 'rps' | 'size' | 'time';
	subject: string;
};

export type CompareOptions = {
	/** Allowed growth ratio for byte counts. Deterministic, so tight. */
	sizeTolerance?: number;
	/** Allowed growth ratio for timings, and allowed SHRINK ratio for
	 *  throughput. Noisy, so loose. */
	timeTolerance?: number;
};

const DEFAULT_SIZE_TOLERANCE = 1.05;
const DEFAULT_TIME_TOLERANCE = 1.25;

/** Everything that got worse by more than its tolerance.
 *
 *  Improvements are not reported: a benchmark gate exists to stop
 *  regressions, and a build that got faster should not need a human to
 *  dismiss a warning about it. */
export const compareRecords = (
	baseline: BenchRecord,
	current: BenchRecord,
	options: CompareOptions = {}
) => {
	const sizeTolerance = options.sizeTolerance ?? DEFAULT_SIZE_TOLERANCE;
	const timeTolerance = options.timeTolerance ?? DEFAULT_TIME_TOLERANCE;
	const regressions: Regression[] = [];

	for (const [name, before] of Object.entries(baseline.sizes)) {
		const after = current.sizes[name];
		/* A framework the current build no longer produces is a change to
		 * report elsewhere, not a size regression. */
		if (after === undefined || before === 0) continue;
		if (after > before * sizeTolerance)
			regressions.push({
				baseline: before,
				current: after,
				kind: 'size',
				subject: name,
				tolerance: sizeTolerance
			});
	}

	if (
		baseline.buildMs !== undefined &&
		current.buildMs !== undefined &&
		current.buildMs > baseline.buildMs * timeTolerance
	)
		regressions.push({
			baseline: baseline.buildMs,
			current: current.buildMs,
			kind: 'time',
			subject: 'build',
			tolerance: timeTolerance
		});

	for (const [label, before] of Object.entries(baseline.throughput ?? {})) {
		const after = current.throughput?.[label];
		if (after === undefined || before.rps === 0) continue;
		/* Throughput regresses by going DOWN, so the comparison is
		 * inverted: dividing by the tolerance rather than multiplying. */
		if (after.rps < before.rps / timeTolerance)
			regressions.push({
				baseline: before.rps,
				current: after.rps,
				kind: 'rps',
				subject: label,
				tolerance: timeTolerance
			});
	}

	return regressions;
};
