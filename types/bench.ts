/** A page `absolute bench` measures render throughput on. */
export type BenchPage = {
	/** How it appears in the report and the baseline. Keep it stable, or
	 *  a rename reads as a page that vanished and a new one appearing. */
	label: string;
	/** Path on the running server, e.g. `/react`. */
	path: string;
};

export type BenchConfig = {
	/** Requests in flight at once while measuring. Default 8. */
	concurrency?: number;
	/** Measured window per page, in milliseconds. Default 3000. */
	durationMs?: number;
	/** Pages to measure. Only your server knows which path renders which
	 *  framework, so there is no default beyond skipping throughput. */
	pages?: BenchPage[];
	/** Build runs to take, reported as a median. Default 1, because a
	 *  build is slow; raise it when a build-time number has to mean
	 *  something. */
	runs?: number;
	/** Server entry to start when measuring throughput, e.g.
	 *  `'server.ts'`. Needed whenever `absolute start` cannot find your
	 *  entry on its own, which is most projects. */
	serverEntry?: string;
	/** Allowed growth ratio for byte counts before `--check` fails.
	 *  Deterministic, so tight. Default 1.05. */
	sizeTolerance?: number;
	/** Allowed growth ratio for timings, and allowed shrink ratio for
	 *  throughput. Machine-dependent, so loose. Default 1.25. */
	timeTolerance?: number;
	/** Discarded window before measuring, in milliseconds. Default 1000.
	 *  The first requests pay for JIT and a cold module graph; counting
	 *  them makes a fast server look slow. */
	warmupMs?: number;
};
