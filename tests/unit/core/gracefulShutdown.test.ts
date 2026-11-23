import { afterEach, describe, expect, test } from 'bun:test';
import { installGracefulShutdown } from '../../../src/core/gracefulShutdown';
import {
	clearShutdownState,
	isShuttingDown
} from '../../../src/core/shutdownState';

/* What a shutdown has to get right, in the order it matters: finish the
 * work already accepted, tell anything asking that this process is leaving,
 * and — above both — never become a process that cannot be stopped. */

const removers: (() => void)[] = [];

afterEach(() => {
	for (const remove of removers.splice(0)) remove();
	clearShutdownState();
});

type Harness = {
	exits: number[];
	logs: string[];
	stops: (boolean | undefined)[];
	waits: number[];
};

type InstallOptions = {
	drainTimeoutMs?: number;
	readinessGraceMs?: number;
	stop?: (close?: boolean) => void | Promise<void>;
};

const install = (options: InstallOptions = {}) => {
	const harness: Harness = { exits: [], logs: [], stops: [], waits: [] };
	const { drain, remove } = installGracefulShutdown({
		drainTimeoutMs: options.drainTimeoutMs,
		readinessGraceMs: options.readinessGraceMs,
		exit: (code) => harness.exits.push(code),
		log: (message) => harness.logs.push(message),
		server: () => ({
			stop: (close?: boolean) => {
				harness.stops.push(close);

				return options.stop?.(close);
			}
		}),
		wait: async (duration) => {
			harness.waits.push(duration);
		}
	});
	removers.push(remove);

	/* The handler is invoked directly rather than by emitting a real
	 * signal. `process.emit('SIGTERM')` runs EVERY listener on the
	 * process, and `buildDirectoryLock` installs one that releases its
	 * lock and calls `process.exit` — so emitting here killed the entire
	 * unit run as soon as any earlier test had imported that module. It
	 * passed when this file ran alone, and failed in CI. */
	const signal = async (name: 'SIGINT' | 'SIGTERM') => {
		await drain(name);
	};

	return { harness, remove, signal };
};

describe('draining', () => {
	/* The defect this exists for: measured, a request 300ms into 1500ms of
	 * work reaches the client as ECONNREFUSED when the process is
	 * signalled. `stop(false)` is what lets it finish — `stop(true)` would
	 * cut it off, which is the thing being fixed. */
	test('stops without closing active connections', async () => {
		const { harness, signal } = install();
		await signal('SIGTERM');

		expect(harness.stops).toEqual([false]);
	});

	test('exits with the conventional code for the signal', async () => {
		const term = install();
		await term.signal('SIGTERM');

		expect(term.harness.exits).toEqual([143]);

		term.remove();
		clearShutdownState();
		const int = install();
		await int.signal('SIGINT');

		expect(int.harness.exits).toEqual([130]);
	});

	/* Anything asking has to be told before the drain, not after it. */
	test('marks the process as shutting down', async () => {
		const { signal } = install();

		expect(isShuttingDown()).toBe(false);

		await signal('SIGTERM');

		expect(isShuttingDown()).toBe(true);
	});

	/* A stop that throws must not leave a process that never exits. */
	test('exits even when stopping throws', async () => {
		const { harness, signal } = install({
			stop: () => {
				throw new Error('already gone');
			}
		});
		await signal('SIGTERM');

		expect(harness.exits).toEqual([143]);
	});
});

describe('it can never hang', () => {
	/* The reason a library may take a signal at all is that it exits
	 * afterwards. A handler that waits forever on a stop that never
	 * resolves is worse than no handler: the process stops responding to
	 * the signal an operator just sent, and they reach for SIGKILL. */
	test('a stop that never resolves still exits, by the deadline', async () => {
		const { harness, signal } = install({
			drainTimeoutMs: 20,
			stop: () => new Promise<void>(() => undefined)
		});
		/* Not awaited: this drain never resolves on its own — the deadline
		 * is what has to end it. */
		void signal('SIGTERM');
		await Bun.sleep(60);

		expect(harness.exits).toEqual([143]);
		/* Politely first, then not. */
		expect(harness.stops).toEqual([false, true]);
		expect(
			harness.logs.some((line) => line.includes('did not finish'))
		).toBe(true);
	});

	/* Two Ctrl+Cs mean it. Waiting out a drain the operator is visibly
	 * trying to skip is what teaches people to use SIGKILL by default. */
	test('a second signal exits at once without draining again', async () => {
		const { harness, signal } = install({
			stop: () => new Promise<void>(() => undefined)
		});
		void signal('SIGTERM');
		await Bun.sleep(5);
		await signal('SIGTERM');

		expect(harness.exits).toEqual([143]);
		/* Still only the one polite stop from the first signal. */
		expect(harness.stops).toEqual([false]);
	});
});

describe('the readiness grace window', () => {
	/* Flipping readiness only helps if a probe can still REACH the
	 * endpoint, and refusing new connections is the first thing a drain
	 * does. Measured without this window: a probe during the drain gets a
	 * connection error, not a 503 — so the flip was unobservable and a
	 * balancer would learn from failed connections instead of a clean
	 * `unready`. With the window it reads `unready`. */
	test('keeps serving for the window before connections are refused', async () => {
		const { harness, signal } = install({ readinessGraceMs: 500 });
		await signal('SIGTERM');

		expect(harness.waits).toEqual([500]);
		/* Readiness is already flipped while that wait is happening. */
		expect(isShuttingDown()).toBe(true);
	});

	/* An operator at a terminal is not a rollout: nothing is going to
	 * deregister them, so the wait is pure delay. */
	test('is skipped for SIGINT', async () => {
		const { harness, signal } = install({ readinessGraceMs: 500 });
		await signal('SIGINT');

		expect(harness.waits).toEqual([]);
		expect(harness.exits).toEqual([130]);
	});

	test('is skipped when it is zero', async () => {
		const { harness, signal } = install({ readinessGraceMs: 0 });
		await signal('SIGTERM');

		expect(harness.waits).toEqual([]);
	});
});

describe('removing the handlers', () => {
	/* A dev server rebuilding its runtime in place, or an embedder running
	 * several servers, would otherwise leave a listener per cycle. */
	test('leaves no listener behind', () => {
		const before = process.listenerCount('SIGTERM');
		const { remove } = install();

		expect(process.listenerCount('SIGTERM')).toBe(before + 1);

		remove();

		expect(process.listenerCount('SIGTERM')).toBe(before);
	});
});
