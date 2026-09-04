/* Cooperative idle scheduler for background dev-boot work.
 *
 * The source-module prewarm used to run flat out the moment the port
 * started serving, monopolising the single JS thread for seconds — the
 * first request and its on-demand page build queued behind it. This runs
 * the same work in small batches that yield to the event loop, and pauses
 * whenever the server is busy (a request in flight, or a build running),
 * so background warm-up can never delay real traffic.
 *
 * Pure and dependency-free on purpose: `isBusy`, `sleep` and the task list
 * are all injected, so the batching/pausing policy is unit-testable
 * without a server. */

export type IdleTask = () => unknown | Promise<unknown>;

export type IdleSchedulerOptions = {
	/** True while real work is happening — pause until it clears. */
	isBusy: () => boolean;
	/** Tasks per batch. One yield to the event loop between batches. */
	batchSize?: number;
	/** Waiting between busy checks while paused. */
	pollMs?: number;
	/** Never pause longer than this in one stretch; a wedged busy signal
	 *  degrades to slow progress instead of no progress. */
	maxPauseMs?: number;
	/** Injected timer, so tests can run without real delays. */
	sleep?: (delayMs: number) => Promise<void>;
};

const DEFAULT_BATCH_SIZE = 12;
const DEFAULT_POLL_MS = 25;
const DEFAULT_MAX_PAUSE_MS = 2_000;
const NO_ENTRIES_YET = -1;

const takeBatch = (iterator: Iterator<IdleTask>, batchSize: number) => {
	const batch: IdleTask[] = [];
	while (batch.length < batchSize) {
		const next = iterator.next();
		if (next.done === true) break;
		batch.push(next.value);
	}

	return batch;
};

const defaultSleep = (delayMs: number) =>
	new Promise<void>((resolve) => {
		const timer = setTimeout(resolve, delayMs);
		// Background warm-up must never hold the process open.
		if (typeof timer === 'object' && 'unref' in timer) timer.unref();
	});

/** Run `tasks` in the background, yielding between batches and pausing
 *  while `isBusy()` is true. Tasks are pulled lazily from the iterator so
 *  a cancelled run stops immediately. */
export const dependencyOrderedSequence = function* (
	files: readonly string[],
	getEntrySources: () => readonly string[],
	getDependencies: () => ReadonlyMap<string, ReadonlySet<string>>
) {
	const remaining = new Set(files);
	let lastEntryCount = NO_ENTRIES_YET;
	let queue: string[] = [];
	while (remaining.size > 0) {
		const entries = getEntrySources();
		const stale = entries.length !== lastEntryCount || queue.length === 0;
		lastEntryCount = stale ? entries.length : lastEntryCount;
		queue = stale
			? prioritiseByDependencies(
					[...remaining],
					entries,
					getDependencies()
				)
			: queue;
		const next = queue.shift();
		if (next === undefined) break;
		if (remaining.delete(next)) yield next;
	}
};
export const prioritiseByDependencies = (
	files: readonly string[],
	entrySources: readonly string[],
	dependencies: ReadonlyMap<string, ReadonlySet<string>>
) => {
	const remaining = new Set(files);
	const ordered: string[] = [];
	const seen = new Set<string>();
	const queue = [...entrySources];
	while (queue.length > 0) {
		const current = queue.shift();
		if (current === undefined || seen.has(current)) continue;
		seen.add(current);
		if (remaining.delete(current)) ordered.push(current);
		const dependenciesOfCurrent = dependencies.get(current) ?? [];
		queue.push(
			...[...dependenciesOfCurrent].filter(
				(dependency) => !seen.has(dependency)
			)
		);
	}
	ordered.push(...files.filter((file) => remaining.has(file)));

	return ordered;
};

export const runWhenIdle = (
	tasks: Iterable<IdleTask>,
	options: IdleSchedulerOptions
) => {
	const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);
	const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
	const maxPauseMs = options.maxPauseMs ?? DEFAULT_MAX_PAUSE_MS;
	const sleep = options.sleep ?? defaultSleep;
	let cancelled = false;

	const waitForIdle = async () => {
		let waited = 0;
		while (!cancelled && options.isBusy() && waited < maxPauseMs) {
			// eslint-disable-next-line no-await-in-loop
			await sleep(pollMs);
			waited += pollMs;
		}
	};

	const run = async () => {
		let completed = 0;
		const iterator = tasks[Symbol.iterator]();
		while (!cancelled) {
			// eslint-disable-next-line no-await-in-loop
			await waitForIdle();
			const batch = cancelled ? [] : takeBatch(iterator, batchSize);
			if (batch.length === 0) break;
			// eslint-disable-next-line no-await-in-loop
			await Promise.all(batch.map((task) => task()));
			completed += batch.length;
			// Hand the event loop back so a request that arrived mid-batch
			// is served before the next one starts.
			// eslint-disable-next-line no-await-in-loop
			await sleep(0);
		}

		return completed;
	};

	return {
		done: run(),
		cancel: () => {
			cancelled = true;
		}
	};
};
