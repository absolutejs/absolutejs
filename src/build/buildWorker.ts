/* Entry for the build worker threads spawned by `workerPool.ts`.
 *
 * Ships as `dist/build/buildWorker.js` (see `scripts/build.ts`) and runs
 * straight from this `.ts` file in a source checkout. It owns no state of
 * its own: every request is `{ id, kind, payload }`, every reply is either
 * the handler's result or the flattened error, and the pool decides what
 * runs here versus on the main thread. */

import type {
	BuildWorkerRequest,
	BuildWorkerResponse
} from '../../types/workerPool';
import {
	isBuildWorkerJobKind,
	runBuildWorkerJobUntyped,
	serialiseWorkerError
} from './workerJobs';

declare const self: Worker;

const reply = (message: BuildWorkerResponse) => self.postMessage(message);
/** `ABSOLUTE_BUILD_WORKERS_TRACE=1` logs every job's handler time per
 *  thread — the quickest way to see whether workers are slow because of
 *  cold caches (first jobs slow, then fast) or contention (uniformly). */
const traceEnabled = Boolean(process.env.ABSOLUTE_BUILD_WORKERS_TRACE);
const threadTag = Math.random().toString(36).slice(2, 6);
let jobCounter = 0;
const traceJob = (kind: string, durationMs: number) => {
	if (!traceEnabled) return;
	jobCounter += 1;
	console.error(
		`[build worker ${threadTag}] job ${jobCounter} ${kind} ${durationMs.toFixed(0)}ms`
	);
};

const isRequest = (value: unknown): value is BuildWorkerRequest =>
	typeof value === 'object' &&
	value !== null &&
	'id' in value &&
	typeof value.id === 'number' &&
	'kind' in value &&
	isBuildWorkerJobKind(value.kind);

const handle = async (request: BuildWorkerRequest) => {
	const startedAt = performance.now();
	try {
		const result = await runBuildWorkerJobUntyped(
			request.kind,
			request.payload
		);
		traceJob(request.kind, performance.now() - startedAt);
		reply({
			durationMs: performance.now() - startedAt,
			id: request.id,
			ok: true,
			result
		});
	} catch (error) {
		reply({
			error: serialiseWorkerError(error),
			id: request.id,
			ok: false
		});
	}
};

self.onmessage = (event: MessageEvent<unknown>) => {
	if (!isRequest(event.data)) return;
	void handle(event.data);
};

reply({ type: 'ready' });
