/** A readiness check. Return `false`, or throw, to say this dependency is
 *  not usable; return nothing (or `true`) when it is.
 *
 *  Keep it cheap and keep it honest: a probe runs it every few seconds, and
 *  a check that talks to a dependency it does not actually need turns an
 *  unrelated outage into this process being taken out of rotation. */
export type HealthCheck = () => boolean | void | Promise<boolean | void>;

export type HealthCheckResult = {
	durationMs: number;
	/** Why it failed: a thrown error's message, `timed out`, or
	 *  `returned false`. */
	error?: string;
	name: string;
	ok: boolean;
};

export type HealthReport = {
	checks: HealthCheckResult[];
	ok: boolean;
};

export type HealthConfig = {
	/** How long a readiness report may be reused, in milliseconds.
	 *  Default 1000; `0` runs every check on every probe.
	 *
	 *  Readiness is an unauthenticated GET that runs whatever the app
	 *  registered, so without a cache it is an amplifier — measured with a
	 *  check doing one 2ms query, 500 concurrent probes produced 500
	 *  invocations in 37ms. Concurrent probes also share one run rather
	 *  than each starting their own. An orchestrator probing every 2-5s
	 *  never sees a cached answer; raising this makes a real outage take
	 *  longer to show. */
	cacheMs?: number;
	/** Include each check's name, duration and error in the response body.
	 *  Default `false`: these endpoints are reachable by anyone who can
	 *  reach the app, and the names of your dependencies are information
	 *  you may not want to publish. Turn it on behind a private network,
	 *  or when debugging. */
	details?: boolean;
	/** Liveness path — is this process running? Default
	 *  `/__absolute/live`. Answers without running any check. */
	liveness?: string;
	/** Readiness path — can this process serve? Default
	 *  `/__absolute/ready`. Runs every registered check and answers 503
	 *  when any fails. */
	readiness?: string;
	/** How long a single check may take before it counts as failed.
	 *  Default 2000ms. A readiness probe that hangs is worse than one that
	 *  fails: the orchestrator's own timeout fires instead, which it
	 *  usually reports as something else entirely. */
	timeoutMs?: number;
};
