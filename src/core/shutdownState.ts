/* Whether this process has begun shutting down.
 *
 * Separate from the draining itself because readiness has to know BEFORE
 * the draining starts, and the two live in different places: readiness is
 * an endpoint, draining is a signal handler.
 *
 * The order is the whole point. On SIGTERM a process behind a load
 * balancer is still in rotation — the balancer finds out it is going away
 * by probing, which takes a cycle or two. So readiness must start failing
 * the moment the signal arrives, and only then does draining wait for the
 * requests already in flight. Draining first and flipping readiness later
 * means the balancer keeps sending new work to a server that has stopped
 * accepting connections, which is a burst of errors rather than a clean
 * handover. (For the flip to be observable at all, the listener has to
 * stay open for a moment after it — see `readinessGraceMs` in
 * `gracefulShutdown.ts`.)
 *
 * On `globalThis` behind a `Symbol.for` for the same reason the health
 * registry is: the app's bundle and the framework runtime can be separate
 * module copies, and the endpoint and the signal handler must agree. */

const SHUTTING_DOWN_KEY = Symbol.for('absolutejs.shuttingDown');

/** Marks the process as going away. Returns false when it was already
 *  marked, so a second signal does not restart a shutdown already under
 *  way. */
export const beginShutdown = () => {
	if (Reflect.get(globalThis, SHUTTING_DOWN_KEY) === true) return false;
	Reflect.set(globalThis, SHUTTING_DOWN_KEY, true);

	return true;
};

/** Testing only: forget that a shutdown began. */
export const clearShutdownState = () => {
	Reflect.set(globalThis, SHUTTING_DOWN_KEY, false);
};

/** True once this process has been asked to stop. Readiness reports
 *  `shutting-down` from that moment, so an orchestrator takes the process
 *  out of rotation while the requests already in flight finish. */
export const isShuttingDown = () =>
	Reflect.get(globalThis, SHUTTING_DOWN_KEY) === true;
