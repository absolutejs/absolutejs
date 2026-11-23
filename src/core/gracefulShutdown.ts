/* Finishing the requests already in flight before the process exits.
 *
 * Measured first, because the item this closes describes a feature and the
 * thing underneath it is a defect: a request 300ms into 1500ms of work,
 * interrupted by SIGTERM, reaches the client as ECONNREFUSED. Not a 502, not
 * a truncated body — the connection is gone. That happens on every deploy,
 * every scale-down and every rollout, for every request in flight.
 *
 * `server.stop(false)` is what fixes it: Bun stops accepting connections and
 * lets the active ones finish. The same request then completes with its 200
 * (measured: 1502ms, exit code 0).
 *
 * Taking a signal is a real cost and this file is the exception that earns
 * it. `flushAccessLogOnExit` deliberately refuses to, and the reasoning
 * there still holds: a listener on SIGINT/SIGTERM SUPPRESSES the default
 * terminate, so whoever installs one must then exit the process, and a
 * feature that merely wants to flush a buffer has no business preempting an
 * app's own shutdown. The difference is that shutdown is this file's entire
 * job, not a side effect of something else.
 *
 * That cost is paid down in three ways:
 *
 * - A HARD DEADLINE. The second half of that warning was getting Ctrl+C
 *   wrong "if it ever failed to exit" — a server that hangs instead of
 *   stopping is worse than one that drops requests, because the operator
 *   cannot even kill it normally. So the deadline is armed before anything
 *   else, it is unref'd so it cannot hold the loop open by itself, and when
 *   it fires the server is force-stopped and the process exits regardless.
 * - CONVENTIONAL EXIT CODES. 143 for SIGTERM, 130 for SIGINT — the codes a
 *   shell and an orchestrator expect from a signalled process, so nothing
 *   downstream reads a clean drain as a crash.
 * - A SECOND SIGNAL EXITS AT ONCE. An operator pressing Ctrl+C twice means
 *   it, and waiting out a drain they are visibly trying to skip is the
 *   behaviour that teaches people to reach for SIGKILL.
 *
 * On `readinessGraceMs`, which the first version of this did not have and
 * needed. Flipping readiness to `shutting-down` is only useful if a probe
 * can still REACH the endpoint — and `stop(false)` refuses new connections
 * immediately, so a probe arriving a moment later gets a connection error
 * rather than a 503 (measured: `connection refused`, with the flip in
 * place and working). Without a window in which the listener is still
 * open, the flip is unobservable over HTTP and a load balancer learns the
 * process is going away from failed connections instead of a clean
 * `unready` — the burst of errors draining exists to avoid.
 *
 * So the order is: flip readiness, keep serving for `readinessGraceMs`,
 * then stop accepting and drain. It defaults to 0 because the right value
 * is the balancer's own deregistration interval, which this cannot know,
 * and because a default wait would slow every Ctrl+C for a benefit only
 * an orchestrated deployment sees. SIGINT never waits: that is an operator
 * at a terminal, not a rollout. */

import { SIGINT_EXIT_CODE, SIGTERM_EXIT_CODE } from '../constants';
import { unrefTimer } from '../utils/unrefTimer';
import { beginShutdown } from './shutdownState';

/** Long enough for ordinary requests and a streamed response to finish,
 *  comfortably inside the grace period orchestrators give before SIGKILL
 *  (Kubernetes defaults to 30s). */
const DEFAULT_DRAIN_TIMEOUT_MS = 10_000;

type Stoppable = {
	stop: (closeActiveConnections?: boolean) => void | Promise<void>;
};

export type GracefulShutdownOptions = {
	/** How long in-flight requests get before the server is stopped
	 *  anyway. Default 10000. */
	drainTimeoutMs?: number;
	/** How long to keep serving AFTER readiness starts reporting
	 *  `shutting-down`, before new connections are refused. Default 0.
	 *  Set it to however long your load balancer takes to notice an
	 *  unready backend, or the flip is unobservable. Ignored for SIGINT. */
	readinessGraceMs?: number;
	/** Testing seam for the grace wait. */
	wait?: (duration: number) => Promise<void>;
	/** Called instead of `process.exit`, for tests. */
	exit?: (code: number) => void;
	/** What to drain. */
	server: () => Stoppable | undefined;
	/** Logged so a slow shutdown is explicable rather than mysterious. */
	log?: (message: string) => void;
};

const SIGNAL_EXIT_CODES: Record<string, number> = {
	SIGINT: SIGINT_EXIT_CODE,
	SIGTERM: SIGTERM_EXIT_CODE
};

/** Installs the handlers. Returns a function removing them, which a dev
 *  server rebuilding its runtime in place needs — without it every rebuild
 *  leaves another listener on the process. */
export const installGracefulShutdown = ({
	drainTimeoutMs = DEFAULT_DRAIN_TIMEOUT_MS,
	exit = (code) => process.exit(code),
	log = (message) => console.log(message),
	readinessGraceMs = 0,
	server,
	wait = (duration) => Bun.sleep(duration)
}: GracefulShutdownOptions) => {
	const signals = Object.keys(SIGNAL_EXIT_CODES);
	const handlers = new Map<string, () => void>();

	const drain = async (signal: string) => {
		const code = SIGNAL_EXIT_CODES[signal] ?? 0;
		/* A second signal means the operator is trying to skip the wait. */
		if (!beginShutdown()) {
			log(`[absolutejs] ${signal} again — exiting now`);
			exit(code);

			return;
		}
		log(
			`[absolutejs] ${signal}: not ready, finishing requests in flight (up to ${drainTimeoutMs}ms)`
		);

		/* Still serving, and now reporting unready, so a balancer can see
		 * the flip and deregister before connections stop being accepted.
		 * SIGINT skips it: an operator at a terminal is not a rollout. */
		if (readinessGraceMs > 0 && signal !== 'SIGINT') {
			log(
				`[absolutejs] serving for a further ${readinessGraceMs}ms so a load balancer can deregister`
			);
			await wait(readinessGraceMs);
		}

		/* Armed before the drain is awaited, so a stop that never resolves
		 * cannot leave the process unkillable by ordinary means. Unref'd so
		 * the timer itself never keeps a finished process alive. */
		const deadline = setTimeout(() => {
			log(
				`[absolutejs] drain did not finish in ${drainTimeoutMs}ms — stopping anyway`
			);
			try {
				server()?.stop(true);
			} catch {
				/* Already gone; the exit below is what matters. */
			}
			exit(code);
		}, drainTimeoutMs);
		unrefTimer(deadline);

		try {
			await server()?.stop(false);
		} catch {
			/* A server that cannot be stopped politely still has to exit. */
		}
		clearTimeout(deadline);
		log('[absolutejs] drained');
		exit(code);
	};

	for (const signal of signals) {
		const handler = () => void drain(signal);
		handlers.set(signal, handler);
		process.on(signal, handler);
	}

	return () => {
		for (const [signal, handler] of handlers)
			process.removeListener(signal, handler);
		handlers.clear();
	};
};
