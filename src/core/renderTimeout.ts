/* How long a page render may take before it is cut off.
 *
 * Without this a render that never finishes never answers. Measured with
 * React and a Suspense boundary that never resolves: the stream produced
 * its shell and then nothing, for as long as anyone waited — no error, no
 * close. The only thing that eventually ends it is Bun's HTTP
 * `idleTimeout`, 240s here, and that reaps the socket with NO error, so
 * the visitor's request simply dies four minutes later.
 *
 * An abort is much better than that, because React answers it properly.
 * Measured: aborting a render with a pending boundary finished the stream
 * 16ms later, called `onError` once, and sent a document containing the
 * shell AND the boundary's fallback. So a cut-off render is a complete
 * page showing its loading state, rather than a connection that dies in
 * silence.
 *
 * This bounds a REACT render. Streaming slots are already bounded
 * separately, at five seconds per slot (`STREAMING_SLOT_TIMEOUT_MS`), and
 * a slot that sets its own `timeoutMs` keeps it — a first draft of this
 * tried to give slots the render budget as a default and the change was
 * dead code, because the slot policy fills that field in before anything
 * reads it. Svelte is not covered either: its renderer builds the whole
 * document before the first byte and its `signal` only stops the chunking
 * of HTML that already exists.
 *
 * The default is generous on purpose. This framework is meant to host
 * streaming and AI workloads, where a render legitimately waits on a slow
 * upstream, and the same reasoning gave `idleTimeout` its 240s. A
 * boundary still pending after thirty seconds is a bug or a dead upstream
 * far more often than it is a slow one, and either way a page with its
 * fallback beats a hang. Projects that disagree can raise it, or set
 * `false` to keep the old behaviour. */

import { unrefTimer } from '../utils/unrefTimer';

const TIMEOUT_KEY = Symbol.for('absolutejs.renderTimeout');

export const DEFAULT_RENDER_TIMEOUT_MS = 30_000;

/** An abort signal for one render, and the cleanup that cancels it.
 *
 *  Returns `undefined` when rendering is unbounded, so a caller passes no
 *  signal at all rather than one that never fires. */
export const createRenderAbort = () => {
	const timeout = renderTimeoutMs();
	if (timeout === undefined) return undefined;
	const controller = new AbortController();
	const timer = setTimeout(() => {
		controller.abort(
			new Error(`Render exceeded ${timeout}ms and was cut off.`)
		);
	}, timeout);
	/* A pending render budget is not a reason to keep the process alive,
	 * which matters for `absolute export`: it should exit once the pages
	 * are written. */
	unrefTimer(timer);

	return {
		signal: controller.signal,
		done: () => clearTimeout(timer)
	};
};

/** The configured budget in ms, or `undefined` when rendering is not
 *  bounded. */
export const renderTimeoutMs = () => {
	const stored: unknown = Reflect.get(globalThis, TIMEOUT_KEY);
	if (stored === false) return undefined;
	if (typeof stored === 'number' && stored > 0) return stored;

	return stored === undefined ? DEFAULT_RENDER_TIMEOUT_MS : undefined;
};

export const setRenderTimeout = (timeout: number | false | undefined) => {
	Reflect.set(globalThis, TIMEOUT_KEY, timeout);
};
