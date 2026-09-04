/* Job contracts for the build worker pool (`src/build/workerPool.ts`).
 *
 * Every payload and result crosses a `postMessage` boundary, so each
 * must be structured-clone safe: plain objects, arrays, strings,
 * numbers and booleans only — no functions, class instances, ASTs or
 * `Map`s. The same contracts run on the main thread when the pool is
 * disabled (`ABSOLUTE_BUILD_WORKERS=0`), which is what keeps the two
 * modes byte-for-byte equivalent. */

/** Pure, per-SFC part of `compileVueFile`. Everything that touches
 *  shared mutable state (HMR caches, style-importer graph, the compile
 *  cache, output writes) stays on the main thread and only the CPU-bound
 *  compile ships here. */
export type VueSfcCompileInput = {
	/** Absolute path of the compiled `.vue` output for the client tree
	 *  — only used to relativise bare package imports, never written. */
	clientOutputPath: string;
	/** `toKebab(basename)` — Vue's scoped-style / template id. */
	componentId: string;
	hmrId: string;
	/** Bare import specifier → compiled child output paths, for `.vue`
	 *  files imported from a package. */
	packageImportRewrites: [string, { client: string; server: string }][];
	serverOutputPath: string;
	/** Source text AFTER `addAutoRouterSetupApp` (entry pages) — the
	 *  worker re-parses it with `@vue/compiler-sfc`. */
	sourceContent: string;
	sourceFilePath: string;
	/** One entry per `<style>` block, in order. Preprocessor languages
	 *  (`lang="scss"` …) are compiled on the main thread first because
	 *  that step records dev-server dependency edges; the worker gets
	 *  plain CSS. */
	styleSources: string[];
};

export type VueSfcCompileOutput = {
	/** Final client intermediate, inline sourcemap included. */
	clientOutput: string;
	/** Compiled CSS per `<style>` block (scoped hashing applied). */
	localCss: string[];
	serverOutput: string;
	/** Absolute path → content hash of every file `compileScript` read
	 *  while resolving imported types (compile-cache verification). */
	typeDepHashes: Record<string, string>;
};

/** One batch of plain `.ts` helpers to transpile into the generated
 *  client and server trees. The worker reads each source itself, so only
 *  paths cross the thread boundary. */
export type TsHelperEmitInput = {
	files: {
		clientOutputPath: string;
		serverOutputPath: string;
		sourcePath: string;
	}[];
};

export type TsHelperEmitOutput = {
	emitted: number;
};

export type SourcemapChainInput = {
	bundleFilePath: string;
	/** Keep `sourcesContent` in the rewritten map. Dev server bundles
	 *  drop it — the sources are on disk and the embedded text was ~90%
	 *  of each bundle's size. */
	sourcesContent: boolean;
};

export type SourcemapChainOutput = {
	/** `false` when the bundle carried no inline map (nothing to do). */
	chained: boolean;
};

/** Diagnostic job — round-trips its payload after an optional delay.
 *  Used by the pool's own tests and by `absolute info`-style probes. */
export type EchoJobInput = {
	delayMs?: number;
	value: unknown;
};

/** Pre-load the modules a job kind needs (e.g. the Vue compiler) so a
 *  worker's first real job does not pay for it. */
export type WarmJobInput = {
	kinds: string[];
};

export type BuildWorkerJobs = {
	echo: { input: EchoJobInput; output: unknown };
	warm: { input: WarmJobInput; output: null };
	'sourcemap-chain': {
		input: SourcemapChainInput;
		output: SourcemapChainOutput;
	};
	'ts-helper-emit': { input: TsHelperEmitInput; output: TsHelperEmitOutput };
	'vue-sfc': { input: VueSfcCompileInput; output: VueSfcCompileOutput };
};

export type BuildWorkerJobKind = keyof BuildWorkerJobs;

export type BuildWorkerRequest = {
	id: number;
	kind: BuildWorkerJobKind;
	payload: unknown;
};

/** Serialised error — `Error` instances do not survive structured clone
 *  with their stack intact on every runtime, so the worker flattens
 *  them and the pool rebuilds an `Error` carrying the worker's stack. */
export type BuildWorkerFailure = {
	message: string;
	name: string;
	stack?: string;
};

export type BuildWorkerResponse =
	| { durationMs: number; id: number; ok: true; result: unknown }
	| { error: BuildWorkerFailure; id: number; ok: false }
	| { type: 'ready' };

export type BuildWorkerStats = {
	/** Wall time between dispatch and reply, measured on the main thread
	 *  — includes any time the reply waited for the main thread. */
	busyMs: number;
	jobs: number;
	/** Time the handler itself ran, measured inside the worker. The gap
	 *  to `busyMs` is main-thread stall. */
	workMs: number;
};

export type BuildWorkerPoolStats = {
	/** Sum of every worker's busy time. */
	busyMs: number;
	/** Sum of every worker's in-handler time. */
	workMs: number;
	/** Jobs that ran on the main thread (pool disabled, or a batch too
	 *  small to be worth spawning workers for). */
	inlineJobs: number;
	jobs: number;
	/** Wall time during which at least one job was in flight. */
	wallMs: number;
	/** `busyMs / (size * wallMs)` — 1 means every worker was saturated
	 *  for the whole busy window. 0 when nothing ran. */
	utilisation: number;
	size: number;
	workers: BuildWorkerStats[];
};

export type BuildWorkerRunOptions = {
	/** Stable key (e.g. a source directory) — the pool prefers routing
	 *  jobs with the same key to the same worker so per-thread caches
	 *  (Vue's imported-type scopes) stay warm. A preference only:
	 *  an idle worker always takes the next job. */
	affinity?: string;
};

export type BuildWorkerPoolOptions = {
	/** Absolute path of the worker entry. Defaults to the framework's own
	 *  `buildWorker` in whichever layout (`src/` or `dist/`) is running. */
	entry?: string;
	/** Terminate every worker after this long with nothing to do. */
	idleTimeoutMs?: number;
	/** Batches smaller than this run inline unless workers are already
	 *  alive — an HMR rebuild of one component must not pay a spawn. */
	minBatch?: number;
	/** Worker count. `0`/`1` = inline. */
	size?: number;
};

export type BuildWorkerPool = {
	/** Worker count the pool will use once started (0 = inline). */
	readonly size: number;
	/** Whether workers are currently alive. */
	isWarm: () => boolean;
	/** `run` uses workers for this batch — pool enabled and either warm
	 *  or the batch is large enough to amortise the spawn. */
	shouldUse: (jobCount: number) => boolean;
	/** Execute a job — on a worker when `shouldUse` said so for the
	 *  batch, otherwise inline. `inline` forces the main-thread path. */
	run: <Kind extends BuildWorkerJobKind>(
		kind: Kind,
		payload: BuildWorkerJobs[Kind]['input'],
		options?: BuildWorkerRunOptions & { inline?: boolean }
	) => Promise<BuildWorkerJobs[Kind]['output']>;
	stats: () => BuildWorkerPoolStats;
	/** Terminate every worker; queued jobs still complete inline. */
	shutdown: () => Promise<void>;
	/** Spawn the workers now and have each pre-load what `kind` needs.
	 *  No-op when the pool is disabled. */
	warm: (kind: BuildWorkerJobKind) => void;
};
