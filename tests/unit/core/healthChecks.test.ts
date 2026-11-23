import { afterEach, describe, expect, test } from 'bun:test';
import {
	clearHealthChecks,
	registerHealthCheck,
	runHealthChecks
} from '../../../src/core/healthChecks';

/* What a readiness check must not be able to do to the probe that runs it.
 *
 * The naive version fails at exactly the job it exists for: a check that
 * hangs hangs the endpoint, so the orchestrator's own timeout fires and
 * reports a timeout instead of "the database is unreachable"; a check that
 * throws 500s the endpoint, which reads as unhealthy by accident, with no
 * name attached to say which dependency it was. */

afterEach(() => {
	clearHealthChecks();
});

const TIMEOUT_MS = 60;

describe('runHealthChecks', () => {
	/* An app that registered nothing is ready. Answering 503 because a
	 * feature is unused would take every default deployment out of
	 * rotation. */
	test('no checks is ready', async () => {
		const report = await runHealthChecks(TIMEOUT_MS);

		expect(report.ok).toBe(true);
		expect(report.checks).toEqual([]);
	});

	test('a passing check', async () => {
		registerHealthCheck('database', () => undefined);
		registerHealthCheck('cache', () => true);
		const report = await runHealthChecks(TIMEOUT_MS);

		expect(report.ok).toBe(true);
		expect(report.checks.map((check) => check.name).sort()).toEqual([
			'cache',
			'database'
		]);
		expect(report.checks.every((check) => check.ok)).toBe(true);
	});

	test('returning false is a failure, with a reason', async () => {
		registerHealthCheck('queue', () => false);
		const report = await runHealthChecks(TIMEOUT_MS);

		expect(report.ok).toBe(false);
		expect(report.checks[0]?.error).toBe('returned false');
	});

	/* A throw must become a named result, not an exception out of the
	 * endpoint. */
	test('a thrown error becomes the reason', async () => {
		registerHealthCheck('database', () => {
			throw new Error('ECONNREFUSED 10.0.0.9:5432');
		});
		const report = await runHealthChecks(TIMEOUT_MS);

		expect(report.ok).toBe(false);
		expect(report.checks[0]).toMatchObject({
			error: 'ECONNREFUSED 10.0.0.9:5432',
			name: 'database',
			ok: false
		});
	});

	test('a rejected promise becomes the reason', async () => {
		registerHealthCheck('cache', async () => {
			await Bun.sleep(1);
			throw new Error('timed out connecting');
		});
		const report = await runHealthChecks(TIMEOUT_MS);

		expect(report.checks[0]?.error).toBe('timed out connecting');
	});

	/* A failure carrying no information must not read as if it carried
	 * some. An `Error` with an empty message stringifies to the word
	 * "Error" and a rejected `undefined` to "undefined", both of which look
	 * like a reason in a report and are not. */
	test('a failure with nothing to say reads as failed', async () => {
		registerHealthCheck('empty', () => {
			throw new Error('');
		});
		registerHealthCheck('nothing', async () => {
			await Bun.sleep(1);

			return Promise.reject();
		});
		const report = await runHealthChecks(TIMEOUT_MS);

		expect(report.ok).toBe(false);
		expect(report.checks.every((check) => check.error === 'failed')).toBe(
			true
		);
	});

	/* A thrown string is legal and carries the reason. */
	test('a thrown string is the reason', async () => {
		registerHealthCheck('odd', () => {
			throw 'pool exhausted';
		});
		const report = await runHealthChecks(TIMEOUT_MS);

		expect(report.checks[0]?.error).toBe('pool exhausted');
	});

	/* The failure this is all for. */
	test('a check that hangs is reported as timed out, not awaited', async () => {
		registerHealthCheck('wedged', () => new Promise<void>(() => undefined));
		const startedAt = performance.now();
		const report = await runHealthChecks(TIMEOUT_MS);
		const elapsed = performance.now() - startedAt;

		expect(report.ok).toBe(false);
		expect(report.checks[0]?.error).toBe('timed out');
		/* Returned on the timeout, not held open by the pending check. */
		expect(elapsed).toBeLessThan(TIMEOUT_MS * 5);
	});

	/* A probe should cost the slowest check, not the sum: three 30ms checks
	 * are 30ms, not 90ms. */
	test('checks run concurrently', async () => {
		for (const name of ['a1', 'b2', 'c3'])
			registerHealthCheck(name, async () => {
				await Bun.sleep(30);
			});
		const startedAt = performance.now();
		const report = await runHealthChecks(1000);
		const elapsed = performance.now() - startedAt;

		expect(report.ok).toBe(true);
		expect(elapsed).toBeLessThan(80);
	});

	test('one failure makes the whole report unready', async () => {
		registerHealthCheck('ok1', () => undefined);
		registerHealthCheck('bad', () => false);
		const report = await runHealthChecks(TIMEOUT_MS);

		expect(report.ok).toBe(false);
		expect(report.checks.filter((check) => check.ok)).toHaveLength(1);
	});

	test('a duration is reported for each check', async () => {
		registerHealthCheck('slow', async () => {
			await Bun.sleep(5);
		});
		const report = await runHealthChecks(1000);

		expect(report.checks[0]?.durationMs).toBeGreaterThan(0);
	});
});

describe('registerHealthCheck', () => {
	/* A dev rebuild re-evaluates the module that registered the check. By
	 * name rather than by identity, so the second evaluation replaces the
	 * first instead of running both. */
	test('the same name replaces rather than accumulates', async () => {
		registerHealthCheck('database', () => false);
		registerHealthCheck('database', () => undefined);
		const report = await runHealthChecks(TIMEOUT_MS);

		expect(report.checks).toHaveLength(1);
		expect(report.ok).toBe(true);
	});

	test('the returned function removes it', async () => {
		const remove = registerHealthCheck('database', () => false);

		expect((await runHealthChecks(TIMEOUT_MS)).ok).toBe(false);

		remove();

		expect((await runHealthChecks(TIMEOUT_MS)).ok).toBe(true);
	});
});

/* Readiness is an unauthenticated GET that runs whatever the app
 * registered, so without these it is an amplifier: measured on a check
 * doing one 2ms query, 500 concurrent probes produced 500 invocations in
 * 37ms. With them, the same 500 probes cost one invocation.
 *
 * Rate limiting is the wrong tool here — a 429 to a readiness probe is a
 * failed probe, and a failed readiness probe takes the process out of
 * rotation — so the cost is bounded instead of the traffic. */
describe('the report is not recomputed per probe', () => {
	test('concurrent probes share one run', async () => {
		let calls = 0;
		registerHealthCheck('database', async () => {
			calls += 1;
			await Bun.sleep(5);
		});

		const reports = await Promise.all(
			Array.from({ length: 50 }, () => runHealthChecks(TIMEOUT_MS))
		);

		expect(calls).toBe(1);
		expect(reports.every((report) => report.ok)).toBe(true);
	});

	test('a report younger than the cache window is reused', async () => {
		let calls = 0;
		registerHealthCheck('database', () => {
			calls += 1;
		});

		await runHealthChecks(TIMEOUT_MS);
		await runHealthChecks(TIMEOUT_MS);
		await runHealthChecks(TIMEOUT_MS);

		expect(calls).toBe(1);
	});

	/* An orchestrator probing every 2-5s never sees a cached answer, which
	 * is the point: the cache collapses floods, not probes. */
	test('a report older than the window is recomputed', async () => {
		let calls = 0;
		registerHealthCheck('database', () => {
			calls += 1;
		});

		await runHealthChecks(TIMEOUT_MS, 10);
		await Bun.sleep(25);
		await runHealthChecks(TIMEOUT_MS, 10);

		expect(calls).toBe(2);
	});

	test('cacheMs 0 runs every check on every probe', async () => {
		let calls = 0;
		registerHealthCheck('database', () => {
			calls += 1;
		});

		await runHealthChecks(TIMEOUT_MS, 0);
		await runHealthChecks(TIMEOUT_MS, 0);

		expect(calls).toBe(2);
	});

	/* A cached report describes the set of checks it ran, so changing the
	 * set has to invalidate it — otherwise a process that answers a probe
	 * before registering its database check reports `ok` on the strength
	 * of having had no checks. */
	test('registering a check invalidates a cached report', async () => {
		await runHealthChecks(TIMEOUT_MS);

		expect((await runHealthChecks(TIMEOUT_MS)).ok).toBe(true);

		registerHealthCheck('database', () => false);

		expect((await runHealthChecks(TIMEOUT_MS)).ok).toBe(false);
	});
});
