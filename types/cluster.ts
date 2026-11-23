export type ClusterConfig = {
	/** How many server processes to run. Defaults to the number of CPU
	 *  cores. One means no clustering. */
	workers?: number;
};

export type ClusterPlan = {
	/** Why clustering is not happening, when `workers` is 1 despite being
	 *  asked for. Printed once at startup rather than swallowed: a cluster
	 *  that silently is not one is worse than no cluster, because the
	 *  per-process state it changes (rate-limit counters, caches) then
	 *  behaves differently in production than where it was tested. */
	reason?: string;
	workers: number;
};
