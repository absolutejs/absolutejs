/* Build worker pool — puts the serial, CPU-bound parts of a build
 * (`@vue/compiler-sfc` per SFC, the per-bundle dev sourcemap chain) on
 * Bun `Worker` threads.
 *
 * Shape:
 *   - `Math.max(2, Math.min(availableParallelism(), 8))` workers, capped
 *     by free memory; `ABSOLUTE_BUILD_WORKERS=n` overrides, `0`/`1` runs
 *     every job inline on the main thread (the supported path for
 *     debugging and for environments without worker support — the job
 *     code is identical either way).
 *   - Jobs are `{ kind, payload }` → result (see `types/workerPool.ts`);
 *     failures come back with the worker's stack.
 *   - Workers spawn lazily on the first job and terminate after an idle
 *     timeout, so `absolute dev` does not keep threads alive between
 *     rebuilds. Small batches run inline unless workers are already
 *     warm — an HMR edit of one component never pays a spawn.
 *   - Per-worker busy time is recorded; `ABSOLUTE_DEV_PROFILE=1` prints
 *     utilisation after each burst of work.
 *
 * The worker entry is resolved for both layouts: `src/build/buildWorker.ts`
 * in a source checkout and `dist/build/buildWorker.js` in the published
 * package (see `scripts/build.ts`). */

import { existsSync, readFileSync } from 'node:fs';
import { availableParallelism, freemem } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MILLISECONDS_IN_A_SECOND } from '../constants';
import { devProfileEnabled } from '../utils/startupTimings';
import type {
	BuildWorkerJobKind,
	BuildWorkerJobs,
	BuildWorkerPool,
	BuildWorkerPoolOptions,
	BuildWorkerPoolStats,
	BuildWorkerResponse,
	BuildWorkerRunOptions,
	BuildWorkerStats
} from '../../types/workerPool';
import {
	deserialiseWorkerError,
	runBuildWorkerJob,
	runBuildWorkerJobUntyped
} from './workerJobs';

const MIN_WORKERS = 2;
const MAX_DEFAULT_WORKERS = 8;
const MAX_OVERRIDE_WORKERS = 64;
/** Each worker loads `typescript` + `@vue/compiler-sfc` (~150 MB); never
 *  spawn more than free memory comfortably covers. */
const WORKER_MEMORY_BUDGET_BYTES = 384 * 1024 * 1024;
const DEFAULT_IDLE_TIMEOUT_MS = 2_000;
const DEFAULT_MIN_BATCH = 4;
const PACKAGE_WALK_DEPTH = 6;
const PERCENT = 100;
const OWN_PACKAGE_NAME = '@absolutejs/absolute';

const parseWorkerOverride = (raw: string | undefined) => {
	if (raw === undefined || raw.trim() === '') return undefined;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed)) return undefined;

	return Math.max(0, Math.min(Math.floor(parsed), MAX_OVERRIDE_WORKERS));
};

/** Worker count for this machine: `ABSOLUTE_BUILD_WORKERS` wins; else
 *  `max(2, min(cores, 8))`, reduced when free memory cannot hold that
 *  many compiler instances. */
export const resolveBuildWorkerCount = (env = process.env) => {
	const override = parseWorkerOverride(env.ABSOLUTE_BUILD_WORKERS);
	if (override !== undefined) return override;
	const byCpu = Math.max(
		MIN_WORKERS,
		Math.min(availableParallelism(), MAX_DEFAULT_WORKERS)
	);
	const byMemory = Math.floor(freemem() / WORKER_MEMORY_BUDGET_BYTES);

	return Math.max(MIN_WORKERS, Math.min(byCpu, byMemory));
};

const isOwnPackageRoot = (dir: string) => {
	const packageFile = join(dir, 'package.json');
	if (!existsSync(packageFile)) return false;
	try {
		const pkg: unknown = JSON.parse(readFileSync(packageFile, 'utf-8'));

		return (
			typeof pkg === 'object' &&
			pkg !== null &&
			'name' in pkg &&
			pkg.name === OWN_PACKAGE_NAME
		);
	} catch {
		return false;
	}
};

const findOwnPackageRoot = (from: string) => {
	let dir = from;
	for (let depth = 0; depth < PACKAGE_WALK_DEPTH; depth++) {
		if (isOwnPackageRoot(dir)) return dir;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}

	return null;
};

/** Absolute path of the worker entry for the running layout, or `null`
 *  when the framework is not on disk in a recognisable shape (e.g.
 *  bundled into a standalone executable) — the pool then runs inline. */
export const resolveBuildWorkerEntry = (fromDir = import.meta.dir) => {
	const root = findOwnPackageRoot(fromDir);
	if (!root) return null;
	const distEntry = join(root, 'dist', 'build', 'buildWorker.js');
	const sourceEntry = join(root, 'src', 'build', 'buildWorker.ts');
	const runningFromDist = fromDir.startsWith(join(root, 'dist'));
	const ordered = runningFromDist
		? [distEntry, sourceEntry]
		: [sourceEntry, distEntry];

	return ordered.find((candidate) => existsSync(candidate)) ?? null;
};

type PendingJob = {
	affinityIndex: number | null;
	kind: BuildWorkerJobKind;
	payload: unknown;
	reject: (error: Error) => void;
	resolve: (result: unknown) => void;
};

type ActiveJob = PendingJob & { id: number; startedAt: number };

/** `lib.dom`'s `Worker` hides Bun's `ref`/`unref` (the project compiles
 *  with the DOM lib for the client runtime). */
type BunWorker = Worker & { ref: () => void; unref: () => void };

type WorkerSlot = {
	active: ActiveJob | null;
	index: number;
	ready: boolean;
	stats: BuildWorkerStats;
	worker: BunWorker;
};

const formatPercent = (ratio: number) => `${Math.round(ratio * PERCENT)}%`;

export const createBuildWorkerPool = (
	options: BuildWorkerPoolOptions = {}
): BuildWorkerPool => {
	const size = options.size ?? resolveBuildWorkerCount();
	const entry =
		options.entry === undefined ? resolveBuildWorkerEntry() : options.entry;
	const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
	const minBatch = options.minBatch ?? DEFAULT_MIN_BATCH;
	const enabled = size > 1 && entry !== null;

	const slots: WorkerSlot[] = [];
	const queue: PendingJob[] = [];
	let nextJobId = 1;
	let inFlight = 0;
	let broken = false;
	let draining = false;
	let idleTimer: ReturnType<typeof setTimeout> | undefined;
	let burstStartedAt: number | null = null;
	let burstBusyAtStart = 0;
	let burstWorkAtStart = 0;
	let burstJobsAtStart = 0;
	const burstBusyBySlot = new Map<number, number>();
	let wallMs = 0;
	let workerJobs = 0;
	let inlineJobs = 0;
	/** Busy / in-handler time of workers that have already been terminated. */
	let retiredBusyMs = 0;
	let retiredWorkMs = 0;
	const retiredStats: BuildWorkerStats[] = [];

	const liveBusyMs = () =>
		slots.reduce((sum, slot) => sum + slot.stats.busyMs, 0) + retiredBusyMs;
	const liveWorkMs = () =>
		slots.reduce((sum, slot) => sum + slot.stats.workMs, 0) + retiredWorkMs;

	const runInline = <Kind extends BuildWorkerJobKind>(
		kind: Kind,
		payload: BuildWorkerJobs[Kind]['input']
	) => {
		inlineJobs += 1;

		return runBuildWorkerJob(kind, payload);
	};

	const runQueuedInline = (job: PendingJob) => {
		inlineJobs += 1;

		return runBuildWorkerJobUntyped(job.kind, job.payload);
	};

	const clearIdleTimer = () => {
		if (idleTimer === undefined) return;
		clearTimeout(idleTimer);
		idleTimer = undefined;
	};

	const terminateWorkers = () => {
		clearIdleTimer();
		for (const slot of slots) {
			retiredBusyMs += slot.stats.busyMs;
			retiredWorkMs += slot.stats.workMs;
			retiredStats.push({ ...slot.stats });
			slot.worker.terminate();
		}
		slots.length = 0;
	};

	const reportBurst = (elapsedMs: number) => {
		if (!devProfileEnabled) return;
		const busyMs = liveBusyMs() - burstBusyAtStart;
		const workMs = liveWorkMs() - burstWorkAtStart;
		const jobs = workerJobs - burstJobsAtStart;
		const capacityMs = Math.max(1, elapsedMs * size);
		const perWorker = slots
			.map((slot) =>
				formatPercent(
					(slot.stats.busyMs -
						(burstBusyBySlot.get(slot.index) ?? 0)) /
						elapsedMs
				)
			)
			.join(' ');
		console.error(
			`[absolute] build workers: ${size} threads ran ${jobs} jobs in ${(elapsedMs / MILLISECONDS_IN_A_SECOND).toFixed(1)}s wall, ${(busyMs / MILLISECONDS_IN_A_SECOND).toFixed(1)}s busy of which ${(workMs / MILLISECONDS_IN_A_SECOND).toFixed(1)}s in handlers (${formatPercent(busyMs / capacityMs)} utilisation, ${formatPercent(workMs / Math.max(1, busyMs))} of busy time was real work; per worker: ${perWorker})`
		);
	};

	const onBurstStart = () => {
		if (burstStartedAt !== null) return;
		burstStartedAt = performance.now();
		burstBusyAtStart = liveBusyMs();
		burstWorkAtStart = liveWorkMs();
		burstJobsAtStart = workerJobs;
		burstBusyBySlot.clear();
		for (const slot of slots) {
			burstBusyBySlot.set(slot.index, slot.stats.busyMs);
		}
		clearIdleTimer();
	};

	const onIdle = () => {
		if (burstStartedAt !== null) {
			const elapsed = performance.now() - burstStartedAt;
			wallMs += elapsed;
			reportBurst(elapsed);
			burstStartedAt = null;
		}
		for (const slot of slots) slot.worker.unref();
		clearIdleTimer();
		if (slots.length === 0) return;
		idleTimer = setTimeout(terminateWorkers, idleTimeoutMs);
		idleTimer.unref();
	};

	const takeJobFor = (slot: WorkerSlot) => {
		const affine = queue.findIndex(
			(job) => job.affinityIndex === slot.index
		);
		const [job] = queue.splice(affine >= 0 ? affine : 0, 1);

		return job;
	};

	const dispatch = (slot: WorkerSlot, job: PendingJob) => {
		const id = nextJobId;
		nextJobId += 1;
		const active: ActiveJob = { ...job, id, startedAt: performance.now() };
		slot.active = active;
		slot.worker.ref();
		slot.worker.postMessage({ id, kind: job.kind, payload: job.payload });
	};

	const pump = () => {
		for (const slot of slots) {
			if (queue.length === 0) break;
			if (!slot.ready || slot.active !== null) continue;
			const job = takeJobFor(slot);
			if (job) dispatch(slot, job);
		}
		if (inFlight === 0 && queue.length === 0) onIdle();
	};

	const drainInline = () => {
		const pending = queue.splice(0, queue.length);
		for (const job of pending) {
			inFlight -= 1;
			job.resolve(runQueuedInline(job));
		}
		if (inFlight === 0) onIdle();
	};

	const settle = (slot: WorkerSlot, response: BuildWorkerResponse) => {
		if ('type' in response) {
			slot.ready = true;
			pump();

			return;
		}
		const { active } = slot;
		if (!active || active.id !== response.id) return;
		slot.active = null;
		slot.stats.busyMs += performance.now() - active.startedAt;
		if (response.ok) slot.stats.workMs += response.durationMs;
		slot.stats.jobs += 1;
		inFlight -= 1;
		workerJobs += 1;
		if (response.ok) active.resolve(response.result);
		else active.reject(deserialiseWorkerError(response.error));
		pump();
	};

	const retire = (slot: WorkerSlot, error: Error) => {
		const position = slots.indexOf(slot);
		if (position >= 0) slots.splice(position, 1);
		retiredBusyMs += slot.stats.busyMs;
		retiredWorkMs += slot.stats.workMs;
		retiredStats.push({ ...slot.stats });
		slot.worker.terminate();
		if (slot.active) {
			inFlight -= 1;
			slot.active.reject(error);
		}
		if (slots.length > 0) {
			pump();

			return;
		}
		// Every worker died (typically an import failure at startup —
		// the entry is missing or the runtime lacks Worker support).
		// Finish the batch inline and stay inline for the process.
		broken = true;
		drainInline();
	};

	const spawn = (index: number, workerEntry: string) => {
		// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- lib.dom's Worker type lacks Bun's ref/unref
		const worker = new Worker(pathToFileURL(workerEntry).href) as BunWorker;
		const slot: WorkerSlot = {
			active: null,
			index,
			ready: false,
			stats: { busyMs: 0, jobs: 0, workMs: 0 },
			worker
		};
		worker.onmessage = (event: MessageEvent<BuildWorkerResponse>) => {
			settle(slot, event.data);
		};
		worker.onerror = (event: ErrorEvent) => {
			const error =
				event.error instanceof Error
					? event.error
					: new Error(
							event.message ||
								`build worker ${index} failed to start`
						);
			retire(slot, error);
		};
		worker.unref();

		return slot;
	};

	const ensureWorkers = () => {
		if (slots.length > 0 || entry === null) return;
		for (let index = 0; index < size; index++) {
			slots.push(spawn(index, entry));
		}
	};

	const isWarm = () => slots.length > 0;

	const shouldUse = (jobCount: number) =>
		enabled && !broken && !draining && (isWarm() || jobCount >= minBatch);

	const enqueue = <Kind extends BuildWorkerJobKind>(
		kind: Kind,
		payload: BuildWorkerJobs[Kind]['input'],
		affinity: string | undefined
	) =>
		new Promise<BuildWorkerJobs[Kind]['output']>((resolve, reject) => {
			onBurstStart();
			inFlight += 1;
			queue.push({
				affinityIndex:
					affinity === undefined
						? null
						: Number(BigInt(Bun.hash(affinity)) % BigInt(size)),
				kind,
				payload,
				reject,
				resolve: (result) => {
					// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- wire boundary: results arrive untyped from postMessage
					resolve(result as BuildWorkerJobs[Kind]['output']);
				}
			});
			ensureWorkers();
			pump();
		});

	const run = <Kind extends BuildWorkerJobKind>(
		kind: Kind,
		payload: BuildWorkerJobs[Kind]['input'],
		runOptions: BuildWorkerRunOptions & { inline?: boolean } = {}
	) => {
		if (runOptions.inline || !enabled || broken || draining) {
			return runInline(kind, payload);
		}

		return enqueue(kind, payload, runOptions.affinity);
	};

	const warm = (kind: BuildWorkerJobKind) => {
		if (!enabled || broken || draining) return;
		ensureWorkers();
		// One warm job per worker: every worker is idle at spawn and the
		// load takes far longer than the ready-stagger, so each takes
		// exactly one; a stray second one is a memoised no-op.
		for (let index = 0; index < slots.length; index++) {
			enqueue('warm', { kinds: [kind] }, undefined).catch(() => {
				/* a failed warm-up only costs the first real job its load */
			});
		}
	};

	const stats = (): BuildWorkerPoolStats => {
		const busyMs = liveBusyMs();
		const workMs = liveWorkMs();
		const currentBurstMs =
			burstStartedAt === null ? 0 : performance.now() - burstStartedAt;
		const totalWallMs = wallMs + currentBurstMs;
		const capacityMs = size * totalWallMs;

		return {
			busyMs,
			inlineJobs,
			jobs: workerJobs + inlineJobs,
			size,
			utilisation: capacityMs > 0 ? busyMs / capacityMs : 0,
			wallMs: totalWallMs,
			workers: [
				...retiredStats,
				...slots.map((slot) => ({ ...slot.stats }))
			],
			workMs
		};
	};

	const activeJobsSettled = () => {
		if (inFlight === 0) return Promise.resolve();

		return new Promise<void>((resolve) => {
			const poll = () => {
				if (inFlight === 0) {
					resolve();

					return;
				}
				setTimeout(poll, 10);
			};
			poll();
		});
	};

	const shutdown = async () => {
		draining = true;
		try {
			await activeJobsSettled();
			terminateWorkers();
		} finally {
			draining = false;
		}
	};

	return { isWarm, run, shouldUse, shutdown, size, stats, warm };
};

let sharedPool: BuildWorkerPool | undefined;

/** Process-wide pool sized from the environment. */
export const getBuildWorkerPool = () => {
	sharedPool ??= createBuildWorkerPool();

	return sharedPool;
};

/** Tear down the shared pool (tests, or after changing
 *  `ABSOLUTE_BUILD_WORKERS`); the next `getBuildWorkerPool` re-creates it. */
export const resetBuildWorkerPool = async () => {
	const pool = sharedPool;
	sharedPool = undefined;
	if (pool) await pool.shutdown();
};
