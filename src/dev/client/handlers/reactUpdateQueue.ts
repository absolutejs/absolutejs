/* Applies React HMR updates one at a time, newest last.
 *
 * Each update re-imports its modules and then refreshes (or remounts) the
 * page. Run unserialized, two updates for one save raced: both imports were
 * in flight together, each refreshed whenever its own import settled, and a
 * cache-busting stamp taken from `Date.now()` could repeat within a
 * millisecond, handing the second update the module instance the first had
 * already evaluated. Here an update that arrives while another is applying
 * waits; updates that pile up meanwhile merge into one, and an update whose
 * import settles after a newer one arrived is not applied on its own: the
 * newer update re-imports every module of both and applies once. */

export type ReactUpdateKind = 'refresh' | 'remount';

export type ReactUpdate = {
	kind: ReactUpdateKind;
	moduleUrls: string[];
	serverDuration?: number;
	updateId?: number;
};

export type ReactUpdateTiming = {
	clientStart: number;
	serverDuration?: number;
	updateId?: number;
};

export type ReactUpdateRunner = {
	apply: (update: ReactUpdate, modules: unknown[]) => void;
	importModule: (url: string) => Promise<unknown>;
	now?: () => number;
	onApplied: (update: ReactUpdate, timings: ReactUpdateTiming[]) => void;
	onFailed: (
		update: ReactUpdate,
		timings: ReactUpdateTiming[],
		error: unknown
	) => void;
};

type Batch = {
	timings: ReactUpdateTiming[];
	update: ReactUpdate;
};

/* A remount renders one page module, so the newer one wins. A refresh
 * needs every edited module re-run: keep the union, the newer update's
 * URLs first (its first URL is the primary one). */
const mergeUpdates = (older: ReactUpdate, newer: ReactUpdate) =>
	older.kind === 'refresh' && newer.kind === 'refresh'
		? {
				...newer,
				moduleUrls: [
					...new Set([...newer.moduleUrls, ...older.moduleUrls])
				]
			}
		: newer;

const mergeBatches = (older: Batch, newer: Batch): Batch => ({
	timings: [...older.timings, ...newer.timings],
	update: mergeUpdates(older.update, newer.update)
});

const withStamp = (url: string, stamp: number) =>
	`${url}${url.includes('?') ? '&' : '?'}t=${stamp}`;

export const createReactUpdateQueue = (runner: ReactUpdateRunner) => {
	const now = runner.now ?? (() => Date.now());
	let pending: Batch | undefined;
	let running = false;
	let lastStamp = 0;

	// Strictly increasing: a repeated stamp re-imports nothing.
	const nextStamp = () => {
		lastStamp = Math.max(lastStamp + 1, now());

		return lastStamp;
	};

	const importAll = (update: ReactUpdate) => {
		const stamp = nextStamp();

		return Promise.all(
			update.moduleUrls.map((url) =>
				runner.importModule(withStamp(url, stamp))
			)
		);
	};

	const applyBatch = async (batch: Batch) => {
		let modules: unknown[];
		try {
			modules = await importAll(batch.update);
		} catch (error) {
			// A newer update may already fix what failed to load.
			if (pending) {
				pending = mergeBatches(batch, pending);

				return;
			}
			runner.onFailed(batch.update, batch.timings, error);

			return;
		}
		if (pending) {
			// Superseded while loading: the newer update loads these modules
			// again, at their newest version, and applies once.
			pending = mergeBatches(batch, pending);

			return;
		}
		try {
			runner.apply(batch.update, modules);
		} catch (error) {
			runner.onFailed(batch.update, batch.timings, error);

			return;
		}
		runner.onApplied(batch.update, batch.timings);
	};

	const drain = async () => {
		while (pending) {
			const batch = pending;
			pending = undefined;
			// eslint-disable-next-line no-await-in-loop -- one at a time on purpose
			await applyBatch(batch);
		}
		running = false;
	};

	const enqueue = (update: ReactUpdate, clientStart: number) => {
		const batch: Batch = {
			timings: [
				{
					clientStart,
					serverDuration: update.serverDuration,
					updateId: update.updateId
				}
			],
			update
		};
		pending = pending ? mergeBatches(pending, batch) : batch;
		if (running) return;
		running = true;
		void drain();
	};

	return {
		enqueue,
		isIdle: () => !running
	};
};
