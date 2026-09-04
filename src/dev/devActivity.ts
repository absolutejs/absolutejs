/* Dev-server activity signals.
 *
 * Background boot work (the source-module prewarm) must never compete with
 * a real request or an on-demand page build for the single JS thread. The
 * counters live on `globalThis` because the runtime bundle and the dev
 * bundles do not share module state, and because they have to survive
 * `bun --hot` re-evaluation. */

const REQUEST_QUIET_MS = 250;
/** An in-flight counter can only leak upwards (a request whose
 *  `afterResponse` never fires), which would stall background work
 *  forever. Treat a stuck counter older than this as idle. */
const REQUEST_STALE_MS = 5_000;

const activity = () =>
	(globalThis.__absoluteDevActivity ??= {
		inFlight: 0,
		lastFinishedAt: 0,
		lastStartedAt: 0
	});

/** True while any build is running: the boot/incremental rebuild lock or
 *  an on-demand page build. */
export const devBuildActive = () => {
	const cached = globalThis.__hmrDevResult;
	const state = cached?.hmrState;
	if (!state) return false;

	return (
		state.isRebuilding === true ||
		(state.lazyPages?.builder.inFlight().length ?? 0) > 0
	);
};

/** True while a request is being served, or was served so recently that
 *  more of the same page load is almost certainly on the way. */
export const devRequestsActive = (now = Date.now()) => {
	const state = activity();
	const busy =
		state.inFlight > 0 && now - state.lastStartedAt < REQUEST_STALE_MS;

	return busy || now - state.lastFinishedAt < REQUEST_QUIET_MS;
};

export const devServerBusy = () => devRequestsActive() || devBuildActive();

export const noteDevRequestEnd = () => {
	const state = activity();
	state.inFlight = Math.max(0, state.inFlight - 1);
	state.lastFinishedAt = Date.now();
};

export const noteDevRequestStart = () => {
	const state = activity();
	state.inFlight += 1;
	state.lastStartedAt = Date.now();
};
