/* Where access log lines actually go.
 *
 * Measured, because the obvious implementation is the expensive one. A
 * bare Elysia route serving 134,480 req/s on this machine, with one line
 * per request added:
 *
 *   nothing emitted              59.5µs per request
 *   console.log per line         75.3µs   (+15.8)
 *   process.stdout.write per line 74.2µs  (+14.7)
 *   buffered, 256 lines or 50ms  64.2µs   (+4.7)
 *
 * So `console.log` is not the problem — a bare `stdout.write` costs the
 * same — and the per-line write is. Batching recovers about 70% of it,
 * which on the example app's React page (17,801 req/s without logging)
 * is the difference between roughly 12% and roughly 3%. Formatting the
 * line and minting the id are not worth discussing by comparison: 0.18µs
 * and 0.03µs.
 *
 * What a buffer costs is the tail. A process killed hard loses whatever
 * has not been flushed — at most 50ms or 256 lines, and exactly the lines
 * someone investigating a crash wants. So: flushed on every normal exit
 * path, and `flushEachLine` turns batching off for anyone who would rather
 * pay the 15.8µs than lose the tail. That is the honest trade, and it is
 * the user's to make rather than mine.
 *
 * The writer is injected, so a test can read what was written without a
 * process to capture. */

import { unrefTimer } from '../utils/unrefTimer';

/** Lines held before a write goes out regardless of the timer. */
const DEFAULT_BUFFER_LIMIT = 256;

/** How long a line may wait when traffic is too slow to fill the buffer.
 *  Short enough that `tail -f` still feels live. */
const DEFAULT_FLUSH_INTERVAL_MS = 50;

export type AccessLogSink = {
	emit: (line: string) => void;
	/** Write everything held, now. Called on exit, and by tests. */
	flush: () => void;
};

export type AccessLogSinkOptions = {
	/** Write one line per request as it finishes, never batching. Costs
	 *  about 15.8µs per request instead of 4.7µs, and loses nothing on a
	 *  hard kill. */
	flushEachLine?: boolean;
	bufferLimit?: number;
	flushIntervalMs?: number;
	/** Defaults to stdout. */
	write?: (text: string) => void;
};

const writeToStdout = (text: string) => {
	process.stdout.write(text);
};

export const createAccessLogSink = ({
	bufferLimit = DEFAULT_BUFFER_LIMIT,
	flushEachLine = false,
	flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
	write = writeToStdout
}: AccessLogSinkOptions = {}) => {
	let held: string[] = [];
	let timer: ReturnType<typeof setTimeout> | null = null;

	const flush = () => {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
		if (held.length === 0) return;
		const text = held.join('');
		held = [];
		write(text);
	};

	const schedule = () => {
		if (timer !== null) return;
		timer = setTimeout(flush, flushIntervalMs);
		/* Detached, so a quiet server holding one line does not keep the
		 * event loop alive waiting to write it. `unrefTimer` rather than
		 * `timer.unref()` because the DOM's numeric timer type is what wins
		 * in this program, where the method does not exist. */
		unrefTimer(timer);
	};

	const emit = (line: string) => {
		if (flushEachLine) {
			write(`${line}\n`);

			return;
		}
		held.push(`${line}\n`);
		if (held.length >= bufferLimit) {
			flush();

			return;
		}
		schedule();
	};

	const sink: AccessLogSink = { emit, flush };

	return sink;
};

/** Flush this sink when the process is on its way out.
 *
 *  `beforeExit` and `exit` only, deliberately. Installing a SIGINT or
 *  SIGTERM handler would be the obvious addition and is the wrong thing
 *  for a library: a listener on those signals SUPPRESSES the default
 *  terminate, so the handler must then exit the process itself — which
 *  means turning on an access log would preempt whatever graceful
 *  shutdown the app has, and get Ctrl+C wrong if it ever failed to exit.
 *  The build-directory lock does take signals, because it holds a lock
 *  that outlives the process and has to release it; a few buffered log
 *  lines do not justify the same reach.
 *
 *  A signal-killed process therefore loses at most the buffer — 50ms or
 *  256 lines. `flushEachLine` is there for anyone who cannot accept that.
 *
 *  Returns a function removing the listeners, which matters for a dev
 *  server that rebuilds its runtime in place: without it, every rebuild
 *  leaves another listener on the process. */
export const flushAccessLogOnExit = (sink: AccessLogSink) => {
	const onExit = () => {
		sink.flush();
	};

	process.on('beforeExit', onExit);
	process.on('exit', onExit);

	return () => {
		process.off('beforeExit', onExit);
		process.off('exit', onExit);
	};
};
