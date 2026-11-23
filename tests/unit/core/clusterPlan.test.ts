import { describe, expect, test } from 'bun:test';
import {
	clusterSupported,
	resolveClusterPlan
} from '../../../src/core/clusterPlan';

/* The decision, kept apart from the spawning so it can be tested without
 * starting anything. The platform rule is the part that matters: a cluster
 * that silently is not one would divide per-process state in production
 * and not divide it where it was tested. */

describe('when clustering is off', () => {
	test('one worker, and nothing to explain', () => {
		expect(resolveClusterPlan(undefined, 'linux', 8)).toEqual({
			workers: 1
		});
		expect(resolveClusterPlan(false, 'linux', 8)).toEqual({ workers: 1 });
	});
});

describe('choosing the worker count', () => {
	test('one per core by default', () => {
		expect(resolveClusterPlan(true, 'linux', 8).workers).toBe(8);
	});

	test('an explicit count wins over the core count', () => {
		expect(resolveClusterPlan({ workers: 3 }, 'linux', 16).workers).toBe(3);
	});

	/* A config file can say anything; none of it should produce a spawn
	 * loop that runs zero times or a fractional number of processes. */
	test('nonsense counts are clamped to something runnable', () => {
		expect(resolveClusterPlan({ workers: 0 }, 'linux', 8).workers).toBe(1);
		expect(resolveClusterPlan({ workers: -4 }, 'linux', 8).workers).toBe(1);
		expect(resolveClusterPlan({ workers: 2.7 }, 'linux', 8).workers).toBe(
			2
		);
	});

	test('a single-core machine says why it is not clustering', () => {
		const plan = resolveClusterPlan(true, 'linux', 1);

		expect(plan.workers).toBe(1);
		expect(plan.reason).toContain('one CPU core');
	});

	/* Asking for exactly one is not a thwarted cluster, so there is
	 * nothing to explain. */
	test('asking for one worker explains nothing', () => {
		expect(resolveClusterPlan({ workers: 1 }, 'linux', 8)).toEqual({
			reason: undefined,
			workers: 1
		});
	});
});

describe('the platform rule', () => {
	/* Measured, not assumed. Linux distributes connections across every
	 * socket bound to the port: 4 workers took 3,245 req/s to 11,077, split
	 * 10891/11236/11253/11107. macOS does not — SO_REUSEPORT there is a
	 * handoff primitive, and the same probe gave 10,850/0/0/0 with no
	 * throughput gain at all. */
	test('only Linux is treated as able to balance', () => {
		expect(clusterSupported('linux')).toBe(true);
		expect(clusterSupported('darwin')).toBe(false);
		expect(clusterSupported('win32')).toBe(false);
	});

	/* Spawning four processes where three will never serve a request is
	 * worse than not clustering: the wasted memory is the least of it,
	 * because per-process state would then be divided by N in production
	 * and not divided at all in testing — a rate limit checked on a Mac
	 * would be four times stricter once deployed. */
	test('elsewhere it runs one process and says why', () => {
		const plan = resolveClusterPlan(true, 'darwin', 10);

		expect(plan.workers).toBe(1);
		expect(plan.reason).toContain('SO_REUSEPORT');
		expect(plan.reason).toContain('darwin');
	});

	test('an explicit worker count does not override the platform', () => {
		expect(resolveClusterPlan({ workers: 8 }, 'darwin', 10).workers).toBe(
			1
		);
	});
});
