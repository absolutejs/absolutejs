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
	sleep?: (ms: number) => Promise<void>;
	/** Called when the run finishes (or is cancelled) with the number of
	 *  tasks that actually ran. */
	onDone?: (completed: number) => void;
};

export type IdleRun = {
	/** Resolves when every task has run (or the run was cancelled). */
	done: Promise<number>;
	cancel: () => void;
};

const DEFAULT_BATCH_SIZE = 12;
const DEFAULT_POLL_MS = 25;
const DEFAULT_MAX_PAUSE_MS = 2_000;

const defaultSleep = (ms: number) =>
	new Promise<void>((resolve) => {
		const timer = setTimeout(resolve, ms);
		// Background warm-up must never hold the process open.
		if (typeof timer === 'object' && 'unref' in timer) timer.unref();
	});

/** Run `tasks` in the background, yielding between batches and pausing
 *  while `isBusy()` is true. Tasks are pulled lazily from the iterator so
 *  a cancelled run stops immediately. */
export const runWhenIdle = (
	tasks: Iterable<() => unknown | Promise<unknown>>,
	options: IdleSchedulerOptions
): IdleRun => {
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
			if (cancelled) break;
			const batch: Array<() => unknown | Promise<unknown>> = [];
			while (batch.length < batchSize) {
				const next = iterator.next();
				if (next.done === true) break;
				batch.push(next.value);
			}
			if (batch.length === 0) break;
			// eslint-disable-next-line no-await-in-loop
			await Promise.all(batch.map((task) => task()));
			completed += batch.length;
			// Hand the event loop back so a request that arrived mid-batch
			// is served before the next one starts.
			// eslint-disable-next-line no-await-in-loop
			await sleep(0);
		}
		options.onDone?.(completed);

		return completed;
	};

	return {
		cancel: () => {
			cancelled = true;
		},
		done: run()
	};
};

/** Order prewarm files so the modules of pages that already exist in the
 *  browser come first: the entry sources, then their transitive imports
 *  (breadth-first), then everything else in the original order. */
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
		for (const dependency of dependencies.get(current) ?? []) {
			if (!seen.has(dependency)) queue.push(dependency);
		}
	}
	for (const file of files) if (remaining.has(file)) ordered.push(file);

	return ordered;
};

/** Lazily yield `files` in dependency-priority order, re-prioritising
 *  whenever the set of entry sources grows (a page built while the
 *  prewarm was paused moves its imports to the front of the queue). */
export function* dependencyOrderedSequence(
	files: readonly string[],
	getEntrySources: () => readonly string[],
	getDependencies: () => ReadonlyMap<string, ReadonlySet<string>>
) {
	const remaining = new Set(files);
	let lastEntryCount = -1;
	let queue: string[] = [];
	while (remaining.size > 0) {
		const entries = getEntrySources();
		if (entries.length !== lastEntryCount || queue.length === 0) {
			lastEntryCount = entries.length;
			queue = prioritiseByDependencies(
				[...remaining],
				entries,
				getDependencies()
			);
		}
		const next = queue.shift();
		if (next === undefined) break;
		if (!remaining.delete(next)) continue;
		yield next;
	}
}
