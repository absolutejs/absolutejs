/* How many server processes to run, and whether this platform can.
 *
 * Kept pure and separate from the spawning so the decision is testable
 * without starting anything.
 *
 * The platform question is not a detail. Clustering here rides
 * SO_REUSEPORT, and what that does differs by kernel:
 *
 *   Linux   distributes connections across every socket bound to the port.
 *           Measured (oven/bun:1.4.4, 4 workers, CPU-bound handler):
 *           3,245 -> 11,077 req/s, a 3.4x gain, spread 10891/11236/11253/
 *           11107 — near-perfect.
 *
 *   macOS   does not. SO_REUSEPORT on Darwin is a handoff primitive, not a
 *           balancer: one socket takes everything. Measured on the same
 *           probe, 4 workers served 10,850 / 0 / 0 / 0 and throughput did
 *           not move.
 *
 * So on anything but Linux this runs a single process and says why. The
 * alternative — spawning four processes where three will never serve a
 * request — is worse than not clustering, and not only because of the
 * wasted memory: per-process state would be divided by N in production
 * and not divided at all in local testing, so a rate limit tested on a Mac
 * would be four times stricter once deployed. */

import { cpus } from 'node:os';
import type { ClusterConfig, ClusterPlan } from '../../types/cluster';

/** Where SO_REUSEPORT load-balances. Verified by measurement on linux and
 *  darwin; everything else is excluded for want of evidence rather than
 *  because it is known not to work. */
const BALANCING_PLATFORMS = new Set(['linux']);

export const clusterSupported = (platform: string = process.platform) =>
	BALANCING_PLATFORMS.has(platform);

export const resolveClusterPlan = (
	config: boolean | ClusterConfig | undefined,
	platform: string = process.platform,
	coreCount: number = cpus().length
): ClusterPlan => {
	if (!config) return { workers: 1 };
	const given: ClusterConfig = typeof config === 'object' ? config : {};
	/* A core count of 0 is not a thing worth trusting; neither is a
	 * negative or fractional worker count from a config file. */
	const requested = given.workers ?? Math.max(1, Math.floor(coreCount));
	const workers = Math.max(1, Math.floor(requested));
	if (workers === 1)
		return {
			reason:
				given.workers === 1
					? undefined
					: 'only one CPU core is available',
			workers: 1
		};
	if (!clusterSupported(platform))
		return {
			reason: `clustering needs SO_REUSEPORT load balancing, which ${platform} does not do — one socket would take every connection, so this runs a single process`,
			workers: 1
		};

	return { workers };
};
