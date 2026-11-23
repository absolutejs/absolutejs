export type ShutdownConfig = {
	/** How long requests already in flight get to finish after SIGTERM or
	 *  SIGINT, before the server is stopped anyway. Default 10000.
	 *
	 *  Keep it comfortably under the grace period whatever runs the process
	 *  allows before it sends SIGKILL — Kubernetes defaults to 30s. A
	 *  deadline longer than that one is not a longer drain, it is a drain
	 *  that gets killed halfway. */
	drainTimeoutMs?: number;
	/** How long to keep serving AFTER readiness starts reporting
	 *  `shutting-down`, before new connections are refused. Default 0.
	 *
	 *  Flipping readiness only helps if a probe can still reach the
	 *  endpoint, and refusing new connections is the first thing a drain
	 *  does — so without this the flip is unobservable over HTTP and a
	 *  balancer learns the process is leaving from failed connections
	 *  instead of a clean `unready`. Set it to however long yours takes to
	 *  deregister an unready backend. Ignored for SIGINT, which is an
	 *  operator at a terminal rather than a rollout. */
	readinessGraceMs?: number;
};
