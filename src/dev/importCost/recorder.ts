/* Module-evaluation recorder for `ABSOLUTE_DEV_IMPORT_COST=1`.
 *
 * The dev child is preloaded with `dist/dev/importCostPreload.js`, which
 * registers a Bun `onLoad` plugin that brackets every JavaScript/TypeScript
 * module it loads with a call into this recorder. The recorder itself has to
 * be reachable from three separate bundles (the preload, the dev bootstrap
 * and the report), so it lives on `globalThis` rather than in module state.
 *
 * The event log is a flat number array on purpose: two pushes per module
 * boundary, no allocation, no string work. Everything expensive — reading the
 * sources back, resolving specifiers, computing dominators — happens after the
 * boot window has closed, in `report.ts`. */

export type ImportCostRecorder = {
	/** The `.absolutejs-hmr-*` copy of the user's entry that the dev
	 *  bootstrap actually imports. Set by the bootstrap. */
	entryModule: string | null;
	/** The developer's own server entry path, for reporting. */
	entryOriginalModule: string | null;
	/** Flat pairs of `code, timeMs`, where `code = moduleIndex * 4 + kind`
	 *  and kind is one of `IMPORT_COST_EVENT`. Numbers, not objects: two
	 *  array pushes per boundary is cheap enough to leave the timings alone. */
	events: number[];
	moduleIds: string[];
	moduleIndexes: Map<string, number>;
	/** Cleared before the report runs so the report's own imports (and any
	 *  later `--hot` re-evaluation) never land in the measurement. */
	recording: boolean;
	/** The first module of the process — the dev bootstrap. Reachability is
	 *  rooted here rather than at the user's entry so that anything the
	 *  bootstrap loads on its own (the framework runtime, via the boot
	 *  prebuild) is correctly seen as shared rather than as the entry's. */
	rootModule: string | null;
};

type ImportCostEventKinds = {
	enter: number;
	exit: number;
	loadEnd: number;
	loadStart: number;
};

export const IMPORT_COST_ENV = 'ABSOLUTE_DEV_IMPORT_COST';

/** Event kinds packed into the low bits of each event code.
 *  `loadStart`/`loadEnd` bracket the plugin's own work so that reading and
 *  rewriting a module is charged to nobody, and the gap that follows — Bun
 *  parsing that module and resolving its imports — is charged to it. */
export const IMPORT_COST_EVENT: ImportCostEventKinds = {
	enter: 2,
	exit: 3,
	loadEnd: 1,
	loadStart: 0
};

export const IMPORT_COST_EVENT_KINDS = 4;

export const ensureImportCostRecorder = () => {
	const existing = globalThis.__absoluteImportCost;
	if (existing !== undefined) return existing;

	const created: ImportCostRecorder = {
		entryModule: null,
		entryOriginalModule: null,
		events: [],
		moduleIds: [],
		moduleIndexes: new Map(),
		recording: true,
		rootModule: null
	};
	globalThis.__absoluteImportCost = created;

	return created;
};

export const importCostEnabled = () => process.env[IMPORT_COST_ENV] === '1';
