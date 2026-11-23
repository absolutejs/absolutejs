/* Liveness and readiness endpoints.
 *
 * On by default, because the thing asking is an orchestrator that has to be
 * configured with a path before it ever sees the app, and because without
 * one the only thing left to probe is a page. Probing a page is wrong in
 * three ways that have nothing to do with cost: a 200 means "this page
 * rendered", so one broken page gets a healthy process restarted; an app
 * with no `/` route answers 404 and reads as dead; and liveness and
 * readiness become the same answer, so a process that is up but cannot
 * reach its database keeps taking traffic. (The cost is real too — on this
 * machine the example app's React page serves 17,801 req/s against 134,480
 * for a trivial route — but a probe every few seconds would not care.)
 *
 * Both answer `no-store`. A cached 200 from a readiness probe is a
 * readiness probe that has stopped working, and a proxy with a default
 * cache policy will happily do that to a GET returning JSON. */

import { Elysia } from 'elysia';
import { runHealthChecks } from '../core/healthChecks';
import { isShuttingDown } from '../core/shutdownState';
import type { HealthConfig } from '../../types/health';

const NO_STORE = {
	'cache-control': 'no-store',
	'content-type': 'application/json; charset=utf-8'
} as const;

const SERVICE_UNAVAILABLE = 503;

export const DEFAULT_LIVENESS_PATH = '/__absolute/live';
export const DEFAULT_READINESS_PATH = '/__absolute/ready';

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { headers: NO_STORE, status });

/** The endpoints, or an empty plugin when `health: false`. */
export const health = (config: boolean | HealthConfig | undefined) => {
	if (config === false)
		return new Elysia({ name: 'absolutejs-health-disabled' });

	const { cacheMs, details, liveness, readiness, timeoutMs } =
		resolveHealthConfig(config);

	return (
		new Elysia({ name: 'absolutejs-health' })
			/* No checks here on purpose. Liveness asks whether the process is
			 * running, and a liveness probe that fails gets the process killed
			 * — so answering it from the state of a database would restart a
			 * healthy server every time its database hiccuped. */
			.get(liveness, () => json({ status: 'ok' }))
			.get(readiness, async () => {
				/* Reported before the checks are even run, and separately
				 * from them: the process is going away, which no amount of
				 * healthy dependencies changes. This is what takes it out
				 * of rotation while the requests already in flight finish
				 * — see src/core/gracefulShutdown.ts for why the order
				 * matters. */
				if (isShuttingDown())
					return json(
						details
							? { checks: [], status: 'shutting-down' }
							: { status: 'shutting-down' },
						SERVICE_UNAVAILABLE
					);
				const report = await runHealthChecks(timeoutMs, cacheMs);
				if (report.ok)
					return json(
						details
							? { checks: report.checks, status: 'ok' }
							: { status: 'ok' }
					);

				return json(
					details
						? { checks: report.checks, status: 'unready' }
						: { status: 'unready' },
					SERVICE_UNAVAILABLE
				);
			})
	);
};

/** Resolved paths and options, with `health: true` and `health: undefined`
 *  meaning the defaults. */
export const resolveHealthConfig = (
	config: boolean | HealthConfig | undefined
) => {
	const given: HealthConfig = typeof config === 'object' ? config : {};

	return {
		cacheMs: given.cacheMs,
		details: given.details === true,
		liveness: given.liveness ?? DEFAULT_LIVENESS_PATH,
		readiness: given.readiness ?? DEFAULT_READINESS_PATH,
		timeoutMs: given.timeoutMs
	};
};
