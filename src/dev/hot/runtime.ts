import {
	disposeResources,
	runOwned,
	type DisposedCounts
} from '../hotResources';
import type { HotModuleAnalysis, StatementPlan } from './analyze';

/* The runtime half of backend HMR (see docs/BACKEND_HMR.md and analyze.ts).
 *
 * Each evaluation of a module's implementation is a version. Rewritten
 * top-level statements call into the version's `__absH` object, which keeps
 * a statement's previous result when nothing it depends on changed, and runs
 * it (attributing what it starts to it) when something did. A version
 * commits when the module finishes evaluating; then whatever the replaced
 * statements had started is stopped. A version that throws is rolled back:
 * what its re-run statements started is stopped and the previous version
 * stays current. */

type ExportMeta = HotModuleAnalysis['exports'];

type Slot = { value: unknown; generation: number };

type Pending = {
	generation: number;
	meta: ExportMeta;
	slots: Map<string, Slot>;
	seen: Set<string>;
	reran: Set<string>;
	/** Ids this version re-runs (decided when it begins). */
	rerun: Set<string>;
	/** Key of every planned id in this version. */
	keys: Map<string, string>;
	/** Exports whose declaring statement re-runs in this version. */
	changedExports: Set<string>;
};

type ModuleRecord = {
	path: string;
	generation: number;
	slots: Map<string, Slot>;
	pending?: Pending;
	cells: Record<string, unknown>;
	meta: ExportMeta;
	current?: Record<string, unknown>;
	watchers: Map<string, Set<(value: unknown) => void>>;
	/** Committed key of every planned id. */
	keys: Map<string, string>;
	/** How many committed versions re-ran each export's statement. */
	revisions: Map<string, number>;
	/** Exports the latest committed version re-ran. */
	lastChanged: Set<string>;
	analysis?: HotModuleAnalysis;
	/** Source the latest loaded version was built from. */
	source?: string;
	/** Import-specifier tag of the version the facade imports. */
	tag: number;
};

type Facade = {
	path: string;
	read: (name: string) => unknown;
	watch: (name: string, update: (value: unknown) => void) => void;
};

const records = new Map<string, ModuleRecord>();

const recordFor = (path: string) => {
	const existing = records.get(path);
	if (existing) return existing;
	const created: ModuleRecord = {
		cells: {},
		generation: 0,
		keys: new Map(),
		lastChanged: new Set(),
		meta: {},
		path,
		revisions: new Map(),
		slots: new Map(),
		tag: 0,
		watchers: new Map()
	};
	records.set(path, created);

	return created;
};

/** Values that know how to release themselves (explicit resource
 *  management): an old pool or client a replaced statement created. */
const disposeValue = async (value: unknown) => {
	if (typeof value !== 'object' || value === null) return;
	const asyncDispose = Reflect.get(value, Symbol.asyncDispose);
	if (typeof asyncDispose === 'function') {
		await Reflect.apply(asyncDispose, value, []);

		return;
	}
	const dispose = Reflect.get(value, Symbol.dispose);
	if (typeof dispose === 'function') Reflect.apply(dispose, value, []);
};

const ownerOf = (path: string, id: string) => `${path}#${id}`;

const dependsOnChange = (
	plan: StatementPlan[],
	changed: boolean[],
	entry: StatementPlan
) =>
	entry.deps.some((dep) => changed[dep] === true && plan[dep]?.cell !== true);

/** Mark statements that reference a re-running declaration, repeating until
 *  nothing more changes. Cells neither pass a change on nor take one. */
const spreadChanges = (plan: StatementPlan[], changed: boolean[]) => {
	const newly = plan
		.map((entry, index) => ({ entry, index }))
		.filter(
			({ entry, index }) =>
				!changed[index] &&
				!entry.cell &&
				dependsOnChange(plan, changed, entry)
		);
	if (newly.length === 0) return;
	for (const { index } of newly) changed[index] = true;
	spreadChanges(plan, changed);
};

/** Which planned statements re-run in a new version: those whose text or
 *  used imports changed, then — until nothing more changes — those that
 *  reference a re-running declaration. Cells neither pass a change on nor
 *  re-initialise because of a neighbour's. */
const decideReruns = (
	record: ModuleRecord,
	plan: StatementPlan[],
	exportsMeta: ExportMeta
) => {
	const keys = plan.map(
		(entry) =>
			`${entry.hash}#${entry.imports
				.map(([module, name, call]) =>
					exportToken(module, name, call === 1)
				)
				.join('|')}`
	);
	const changed = plan.map(
		(entry, index) =>
			entry.always ||
			entry.ids.some((id) => record.keys.get(id) !== keys[index])
	);
	spreadChanges(plan, changed);
	const rerun = new Set<string>();
	const keyById = new Map<string, string>();
	plan.forEach((entry, index) => {
		for (const id of entry.ids) {
			keyById.set(id, keys[index] ?? '');
			if (changed[index]) rerun.add(id);
		}
	});
	const changedExports = new Set(
		Object.entries(exportsMeta)
			.filter(([, meta]) => meta.plan >= 0 && changed[meta.plan] === true)
			.map(([name]) => name)
	);

	return { changedExports, keys: keyById, rerun };
};

const begin = (path: string, meta: ExportMeta, plan: StatementPlan[]) => {
	const record = recordFor(path);
	record.generation += 1;
	const pending: Pending = {
		generation: record.generation,
		meta,
		reran: new Set(),
		seen: new Set(),
		slots: new Map(),
		...decideReruns(record, plan, meta)
	};
	record.pending = pending;
	const { generation } = pending;
	const owned = <Result>(id: string, work: () => Result) =>
		runOwned(ownerOf(path, id), generation, work);
	/** The previous slot when the statement is kept, else `undefined`. */
	const kept = (id: string) => {
		pending.seen.add(id);
		const previous = record.slots.get(id);
		if (previous && !pending.rerun.has(id)) {
			pending.slots.set(id, previous);

			return previous;
		}
		pending.reran.add(id);

		return undefined;
	};
	const store = (id: string, value: unknown) => {
		pending.slots.set(id, { generation, value });

		return value;
	};

	return {
		cells: record.cells,
		/** A top-level `let`/`var`: set its initial value only when the
		 *  declaration changed; otherwise keep what the app last stored. */
		c: (name: string, id: string, init: () => unknown) => {
			if (kept(id) && name in record.cells) return;
			record.cells[name] = owned(id, init);
			store(id, undefined);
		},
		ca: async (name: string, id: string, init: () => Promise<unknown>) => {
			if (kept(id) && name in record.cells) return;
			record.cells[name] = await owned(id, init);
			store(id, undefined);
		},
		end: () => commit(record, pending),
		/** A declaration: its previous value, or a fresh one. */
		k: (id: string, factory: () => unknown) => {
			const previous = kept(id);
			if (previous) return previous.value;

			return store(id, owned(id, factory));
		},
		ka: async (id: string, factory: () => Promise<unknown>) => {
			const previous = kept(id);
			if (previous) return previous.value;

			return store(id, await owned(id, factory));
		},
		/** A statement run for its effect, only when it re-runs. */
		r: (id: string, effect: () => unknown) => {
			if (kept(id)) return;
			owned(id, effect);
			store(id, undefined);
		},
		ra: async (id: string, effect: () => Promise<unknown>) => {
			if (kept(id)) return;
			await owned(id, effect);
			store(id, undefined);
		}
	};
};

/** What an importer's statement depends on when it uses an export while
 *  evaluating: how many times the export's statement re-ran. A function
 *  that is only referenced is reached through a stable forwarder, so it is
 *  no dependency at all. */
const exportToken = (module: string, name: string, call: boolean) => {
	const record = records.get(module);
	if (!record) return '';
	const meta = record.pending?.meta ?? record.meta;
	if (name === '*')
		return [...record.revisions.entries()]
			.map(([exported, revision]) => `${exported}:${revision}`)
			.sort()
			.join(',');
	const entry = meta[name];
	if (!entry) return '';
	if (entry.kind === 'function' && !call) return '';

	return `${entry.kind}:${record.revisions.get(name) ?? 0}`;
};

const statementOwners = (path: string, ids: Iterable<string>) =>
	new Set([...ids].map((id) => ownerOf(path, id)));

const logDisposed = (path: string, counts: DisposedCounts) => {
	const parts = Object.entries(counts).map(
		([kind, count]) => `${count} ${kind}${count === 1 ? '' : 's'}`
	);
	if (parts.length > 0)
		console.log(
			`[hmr] stopped ${parts.join(', ')} started by replaced code in ${path}`
		);
};

/** Stop what the replaced statements of a committed version started. */
const stopReplaced = async (
	record: ModuleRecord,
	pending: Pending,
	replaced: Map<string, Slot>
) => {
	const owners = statementOwners(record.path, replaced.keys());
	const counts = await disposeResources(
		(owner, generation) =>
			owners.has(owner) && generation < pending.generation
	);
	await Promise.all(
		[...replaced.values()].map((slot) =>
			disposeValue(slot.value).catch((error: unknown) =>
				console.error(`[hmr] disposing a replaced value failed:`, error)
			)
		)
	);
	if (record.generation > 1) logDisposed(record.path, counts);
};

const commit = (record: ModuleRecord, pending: Pending) => {
	if (record.pending !== pending) return;
	record.pending = undefined;
	const replaced = new Map<string, Slot>();
	for (const [id, slot] of record.slots)
		if (pending.reran.has(id) || !pending.seen.has(id))
			replaced.set(id, slot);
	record.slots = pending.slots;
	record.meta = pending.meta;
	record.keys = pending.keys;
	record.lastChanged = pending.changedExports;
	for (const name of pending.changedExports)
		record.revisions.set(name, (record.revisions.get(name) ?? 0) + 1);
	if (replaced.size === 0) return;
	void stopReplaced(record, pending, replaced);
};

/** Undo a version that threw: stop what its re-run statements started and
 *  keep the previous version current. */
export const rollback = async (path: string) => {
	const record = records.get(path);
	const pending = record?.pending;
	if (!record || !pending) return;
	record.pending = undefined;
	const owners = statementOwners(path, pending.reran);
	await disposeResources(
		(owner, generation) =>
			owners.has(owner) && generation === pending.generation
	);
	await Promise.all(
		[...pending.reran]
			.map((id) => pending.slots.get(id)?.value)
			.map((value) => disposeValue(value).catch(() => undefined))
	);
};

const facade = (path: string, namespace: Record<string, unknown>): Facade => {
	const record = recordFor(path);
	record.current ??= namespace;

	return {
		path,
		read: (name) => record.current?.[name],
		watch: (name, update) => {
			const set = record.watchers.get(name) ?? new Set();
			set.add(update);
			record.watchers.set(name, set);
		}
	};
};

/** Make `namespace` the version importers reach, updating every facade's
 *  live bindings whose value changed. */
export const setCurrent = (
	path: string,
	namespace: Record<string, unknown>
) => {
	const record = recordFor(path);
	const previous = record.current;
	record.current = namespace;
	for (const [name, updates] of record.watchers) {
		const value = namespace[name];
		if (previous && Object.is(previous[name], value)) continue;
		for (const update of updates) update(value);
	}
};

/** A facade's exported function: call the latest version (or, while an
 *  import cycle evaluates the facade, the version it imports). */
const forward = (
	target: Facade | undefined,
	initial: Record<string, unknown>,
	name: string,
	thisArg: unknown,
	args: unknown[],
	newTarget: unknown
) => {
	const source = target ? records.get(target.path)?.current : undefined;
	const callee = (source ?? initial)[name];
	if (typeof callee !== 'function')
		throw new TypeError(
			`${name} is no longer a function in ${target?.path ?? 'its module'} after a hot update`
		);
	if (typeof newTarget === 'function')
		return Reflect.construct(callee, args, newTarget);

	return Reflect.apply(callee, thisArg, args);
};

export const currentTag = (path: string) => records.get(path)?.tag ?? 0;
export const managedModule = (path: string) => records.has(path);
export const moduleRecord = (path: string) => records.get(path);
export const nextTag = (path: string) => {
	const record = recordFor(path);
	record.tag += 1;

	return record.tag;
};
export const setAnalysis = (
	path: string,
	analysis: HotModuleAnalysis,
	source: string
) => {
	const record = recordFor(path);
	record.analysis = analysis;
	record.source = source;
};

export type AbsoluteHot = {
	begin: typeof begin;
	facade: typeof facade;
	forward: typeof forward;
};

/** Expose the runtime to rewritten modules. Dev only. */
export const installHotRuntime = () => {
	globalThis.__absoluteHot ??= { begin, facade, forward };
};
