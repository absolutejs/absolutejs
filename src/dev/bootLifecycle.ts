/* Dev-boot lifecycle signals shared between the framework runtime
 * (`dist/index.js`) and the dev bootstrap (`dist/dev/serverBootstrap.js`).
 * The two are separate bundles, so everything here lives on `globalThis`
 * rather than in module state — the same convention the rest of the dev
 * runtime uses for state that must survive `bun --hot` re-evaluation. */

import { MILLISECONDS_IN_A_SECOND } from '../constants';

const DEFERRED_TASK_FALLBACK_SECONDS = 15;

/** Record which boot step is currently running so the early listener's
 *  "Building…" page can show it. Cheap enough to call from every step. */
export const getBootPhase = () => globalThis.__absoluteBootPhase;
export const setBootPhase = (phase: string) => {
	globalThis.__absoluteBootPhase = phase;
};

type DeferredBootTask = () => void | Promise<void>;

const runTask = async (task: DeferredBootTask) => {
	try {
		await task();
	} catch (error) {
		console.error(
			`[dev] deferred boot task failed: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
	}
};

/** Run every task queued by `deferUntilServing`. Called by the
 *  `networking` plugin once the real server is bound, so the work runs
 *  after the port is serving real traffic instead of delaying it. */
export const deferUntilServing = (task: DeferredBootTask) => {
	if (globalThis.__absoluteDeferredBootTasksRan) {
		void runTask(task);

		return;
	}
	const queue = globalThis.__absoluteDeferredBootTasks ?? [];
	globalThis.__absoluteDeferredBootTasks = queue;
	queue.push(task);
	const timer = setTimeout(
		runDeferredBootTasks,
		DEFERRED_TASK_FALLBACK_SECONDS * MILLISECONDS_IN_A_SECOND
	);
	// Never keep the process alive just for the fallback flush.
	if (typeof timer === 'object' && 'unref' in timer) timer.unref();
};
export const runDeferredBootTasks = () => {
	const tasks = globalThis.__absoluteDeferredBootTasks ?? [];
	globalThis.__absoluteDeferredBootTasks = [];
	globalThis.__absoluteDeferredBootTasksRan = true;
	for (const task of tasks) void runTask(task);
};
