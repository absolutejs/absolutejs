/* Readiness checks: registering them, and running them without letting
 * one of them take the probe down with it.
 *
 * Liveness and readiness are different questions and the difference is the
 * whole reason this exists. "Is the process running" is answered by
 * answering at all. "Can it serve" depends on things the framework cannot
 * know about — a database pool, a cache, a queue — so the app registers
 * those, and a probe runs them.
 *
 * What a naive version gets wrong is the failure it is supposed to report.
 * A check that hangs would hang the probe, so the orchestrator's own
 * timeout fires instead and reports a timeout rather than "the database is
 * unreachable". A check that throws would 500 the endpoint, which an
 * orchestrator reads as "unhealthy" by accident rather than on purpose,
 * with no name attached. So every check is raced against a timeout and
 * every throw is caught and turned into a named result, and the checks run
 * concurrently — a probe should cost the slowest check, not the sum.
 *
 * The registry lives on `globalThis` behind a `Symbol.for`, like the
 * request context and the vitals handlers: the app's own bundle and the
 * framework runtime can be separate module copies, and a check registered
 * through one has to be visible to the other. */

import type {
	HealthCheck,
	HealthCheckResult,
	HealthReport
} from '../../types/health';

const HEALTH_CHECKS_KEY = Symbol.for('absolutejs.healthChecks');

/** Long enough for a cold connection pool, short enough to answer before
 *  an orchestrator's own probe timeout. */
const DEFAULT_TIMEOUT_MS = 2000;

/* How long a report may be reused.
 *
 * Readiness is an unauthenticated GET that runs whatever the app
 * registered, so without this it is an amplifier: measured on the example
 * of a check doing one 2ms query, 500 concurrent probes produced 500
 * invocations in 37ms. A cheap public request should not cost more than
 * it costs the caller.
 *
 * One second rather than something cleverer because of what the two
 * consumers look like: an orchestrator probes every 2-5s and never sees a
 * cached answer, while a flood collapses onto one run. Longer would make
 * a real outage take longer to show; `cacheMs: 0` turns it off. */
const DEFAULT_CACHE_MS = 1000;

type CachedReport = { at: number; report: HealthReport };

let cached: CachedReport | undefined = undefined;
/* Concurrent probes share one run rather than starting their own. The TTL
 * alone would not help here: 500 requests arriving together all miss a
 * cache that nothing has filled yet. */
let inFlight: Promise<HealthReport> | undefined = undefined;

const isCheckMap = (value: unknown): value is Map<string, HealthCheck> =>
	value instanceof Map;

const getChecks = () => {
	const existing = Reflect.get(globalThis, HEALTH_CHECKS_KEY);
	if (isCheckMap(existing)) return existing;
	const checks = new Map<string, HealthCheck>();
	Reflect.set(globalThis, HEALTH_CHECKS_KEY, checks);

	return checks;
};

/* `String(error)` is not enough on its own: an `Error` with an empty
 * message stringifies to the word "Error", and a rejection carrying
 * `undefined` to "undefined" — both of which read in a report as if they
 * meant something. Anything with no information in it becomes `failed`. */
const describeError = (error: unknown) => {
	if (error === null || error === undefined) return 'failed';
	const described = error instanceof Error ? error.message : String(error);

	return described.trim() === '' ? 'failed' : described;
};

/** Race one check against the clock. Resolves rather than rejects: a
 *  result with `ok: false` is the report, not an exception. */
const runCheck = async (
	name: string,
	check: HealthCheck,
	timeoutMs: number
) => {
	const startedAt = performance.now();
	let timer: ReturnType<typeof setTimeout> | undefined = undefined;
	const timeout = new Promise<'timeout'>((resolve) => {
		timer = setTimeout(() => resolve('timeout'), timeoutMs);
	});

	const outcome = await Promise.race([
		Promise.resolve()
			.then(check)
			.then((value) => (value === false ? 'returned false' : null))
			.catch((error: unknown) => describeError(error)),
		timeout
	]);
	/* Always, including on the timeout path: a pending timer would hold
	 * the event loop open for its full duration on every probe. */
	clearTimeout(timer);

	const result: HealthCheckResult = {
		durationMs: performance.now() - startedAt,
		name,
		ok: outcome === null,
		...(outcome === null
			? {}
			: { error: outcome === 'timeout' ? 'timed out' : outcome })
	};

	return result;
};

/** For tests and for a dev runtime that rebuilds in place. Drops the
 *  cached report too: a test that registers a failing check must not read
 *  the previous test's answer. */
export const clearHealthChecks = () => {
	getChecks().clear();
	cached = undefined;
	inFlight = undefined;
};

/** Register a readiness check under a name. Registering the same name
 *  again replaces it, so a module that re-evaluates (dev HMR) does not
 *  accumulate duplicates. Returns a function that removes it. */
export const registerHealthCheck = (name: string, check: HealthCheck) => {
	const checks = getChecks();
	checks.set(name, check);
	/* A cached report describes the set of checks it ran, so changing the
	 * set invalidates it. Without this, a process that boots, answers one
	 * probe, and only then registers its database check would report
	 * `ok` for up to `cacheMs` on the strength of having had no checks —
	 * and a removed check would keep failing readiness just as long. */
	cached = undefined;

	return () => {
		checks.delete(name);
		cached = undefined;
	};
};

/** Run every registered check concurrently and report. An app with no
 *  checks is ready: nothing has claimed otherwise, and answering 503
 *  because a feature is unused would take every default deployment out of
 *  rotation. */
const runChecksNow = async (timeoutMs: number) => {
	const checks = [...getChecks()];
	const results = await Promise.all(
		checks.map(([name, check]) => runCheck(name, check, timeoutMs))
	);
	const report: HealthReport = {
		checks: results,
		ok: results.every((result) => result.ok)
	};

	return report;
};

/** Run every registered check concurrently and report, reusing a report
 *  younger than `cacheMs` and joining a run already in progress. */
export const runHealthChecks = async (
	timeoutMs = DEFAULT_TIMEOUT_MS,
	cacheMs = DEFAULT_CACHE_MS
) => {
	const now = performance.now();
	if (cached !== undefined && now - cached.at < cacheMs) return cached.report;
	if (inFlight !== undefined) return inFlight;

	inFlight = runChecksNow(timeoutMs)
		.then((report) => {
			cached = { at: performance.now(), report };

			return report;
		})
		.finally(() => {
			inFlight = undefined;
		});

	return inFlight;
};
