/* Job dispatcher shared by the build worker entry (`buildWorker.ts`) and
 * the pool's inline fallback. Handlers are imported lazily so a worker
 * that only ever chains sourcemaps never loads `@vue/compiler-sfc` +
 * `typescript`, and so `workerPool.ts` can import this module without
 * dragging the compilers into every consumer of the pool. */

import type {
	BuildWorkerFailure,
	BuildWorkerJobKind,
	BuildWorkerJobs,
	EchoJobInput,
	SourcemapChainInput,
	TsHelperEmitInput,
	VueSfcCompileInput,
	WarmJobInput
} from '../../types/workerPool';

const runEcho = async ({ delayMs, value }: EchoJobInput) => {
	if (delayMs && delayMs > 0) {
		await Bun.sleep(delayMs);
	}

	return value;
};

const runSourcemapChain = async ({
	bundleFilePath,
	sourcesContent
}: SourcemapChainInput) => {
	const { chainBundleInlineSourcemap } = await import(
		'./chainInlineSourcemaps'
	);

	return {
		chained: chainBundleInlineSourcemap(bundleFilePath, { sourcesContent })
	};
};

const runTsHelperEmit = async (input: TsHelperEmitInput) => {
	const { emitTsHelpers } = await import('./emitTsHelpers');

	return emitTsHelpers(input);
};

const runVueSfc = async (input: VueSfcCompileInput) => {
	const { compileVueSfc } = await import('./compileVueSfc');

	return compileVueSfc(input);
};

const warmVueSfc = async () => {
	const [{ loadVueCompiler }] = await Promise.all([
		import('../utils/vueCompiler'),
		import('./compileVueSfc')
	]);
	await loadVueCompiler();
};

const warmers: Record<string, () => Promise<unknown>> = {
	'vue-sfc': warmVueSfc,
	'sourcemap-chain': () => import('./chainInlineSourcemaps'),
	'ts-helper-emit': () => import('./emitTsHelpers')
};

const runWarm = async ({ kinds }: WarmJobInput) => {
	await Promise.all(kinds.map((kind) => warmers[kind]?.()));

	return null;
};

const handlers: {
	[Kind in BuildWorkerJobKind]: (
		payload: BuildWorkerJobs[Kind]['input']
	) => Promise<BuildWorkerJobs[Kind]['output']>;
} = {
	echo: runEcho,
	'sourcemap-chain': runSourcemapChain,
	'ts-helper-emit': runTsHelperEmit,
	'vue-sfc': runVueSfc,
	warm: runWarm
};

/** Rebuild an `Error` on the receiving side that keeps the worker's
 *  stack (where the job actually failed) ahead of the caller's frames. */
export const deserialiseWorkerError = (failure: BuildWorkerFailure) => {
	const error = new Error(failure.message);
	error.name = failure.name;
	if (failure.stack) {
		error.stack = `${failure.stack}\n    [dispatched from the build worker pool]\n${error.stack ?? ''}`;
	}

	return error;
};

export const isBuildWorkerJobKind = (
	value: unknown
): value is BuildWorkerJobKind =>
	typeof value === 'string' && Object.hasOwn(handlers, value);

/** Typed entry for callers that hold a concrete job kind. */
export const runBuildWorkerJob = <Kind extends BuildWorkerJobKind>(
	kind: Kind,
	payload: BuildWorkerJobs[Kind]['input']
) =>
	// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the handler table is indexed by `kind`, which TypeScript cannot correlate back to the generic
	runBuildWorkerJobUntyped(kind, payload) as Promise<
		BuildWorkerJobs[Kind]['output']
	>;

/** Run one job on the calling thread from an untyped wire message —
 *  the worker entry and the pool's inline fallback both land here. The
 *  handler table is keyed by kind, so this is the single place where the
 *  wire's `unknown` payload meets a typed handler. */
export const runBuildWorkerJobUntyped = (
	kind: BuildWorkerJobKind,
	payload: unknown
) => {
	// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- wire boundary: payloads arrive untyped from postMessage
	const handler = handlers[kind] as (input: unknown) => Promise<unknown>;

	return handler(payload);
};

export const serialiseWorkerError = (error: unknown) => {
	const failure: BuildWorkerFailure =
		error instanceof Error
			? { message: error.message, name: error.name, stack: error.stack }
			: { message: String(error), name: 'Error' };

	return failure;
};
