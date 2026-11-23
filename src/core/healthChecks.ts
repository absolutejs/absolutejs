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

/** For tests and for a dev runtime that rebuilds in place. */
export const clearHealthChecks = () => {
	getChecks().clear();
};

/** Register a readiness check under a name. Registering the same name
 *  again replaces it, so a module that re-evaluates (dev HMR) does not
 *  accumulate duplicates. Returns a function that removes it. */
export const registerHealthCheck = (name: string, check: HealthCheck) => {
	const checks = getChecks();
	checks.set(name, check);

	return () => {
		checks.delete(name);
	};
};

/** Run every registered check concurrently and report. An app with no
 *  checks is ready: nothing has claimed otherwise, and answering 503
 *  because a feature is unused would take every default deployment out of
 *  rotation. */
export const runHealthChecks = async (timeoutMs = DEFAULT_TIMEOUT_MS) => {
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
