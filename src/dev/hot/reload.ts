import { readFileSync, realpathSync } from 'node:fs';
import { relative } from 'node:path';
import { importersOf } from '../backendGraph';
import type { HotModuleAnalysis } from './analyze';
import { analyzeSource, isHotManaged } from './plugin';
import { moduleRecord, nextTag, rollback, setCurrent } from './runtime';

/* Applying an edit to a server module (see docs/BACKEND_HMR.md): import the
 * module's next version, make it current, then re-run — as new versions —
 * only the importers whose top-level statements used a changed export while
 * evaluating. Unchanged statements of every re-run module keep their
 * values. Edits are applied one at a time, in the order they arrive. */

export type ServerChangeOutcome =
	| { status: 'applied'; modules: string[]; entry: boolean; ms: number }
	| { status: 'failed'; error: unknown }
	| { status: 'entry' }
	| { status: 'unchanged' }
	| { status: 'unmanaged' };

type ExportMeta = HotModuleAnalysis['exports'];
type Advanced =
	| { ok: true; changed: Set<string> }
	| { ok: false; error: unknown };
type Pending = { module: string; changed: Set<string> };
type Propagation = { modules: string[]; entryAffected: boolean; steps: number };

const MAX_PROPAGATION_STEPS = 500;

const realPath = (path: string) => {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
};

const shapeOf = (analysis: HotModuleAnalysis | undefined) =>
	analysis
		? JSON.stringify([
				Object.entries(analysis.exports)
					.map(([name, meta]) => [name, meta.kind])
					.sort(),
				analysis.reexports
			])
		: '';

/** Exports importers must react to: added, removed, changed kind, or whose
 *  declaring statement re-ran in the version just committed. */
const changedExports = (
	before: ExportMeta,
	after: ExportMeta,
	reran: Set<string>
) => {
	const changed = new Set(reran);
	for (const name of new Set([
		...Object.keys(before),
		...Object.keys(after)
	])) {
		const previous = before[name];
		const next = after[name];
		if (!previous || !next || previous.kind !== next.kind)
			changed.add(name);
	}

	return changed;
};

/** True when `importer` used one of `changed` while it evaluated: called a
 *  changed function, or read a changed value. */
const usesChange = (
	importer: HotModuleAnalysis,
	module: string,
	changed: Set<string>
) => {
	const meta = moduleRecord(module)?.meta ?? {};

	return importer.plan.some((entry) =>
		entry.imports.some(([source, name, call]) => {
			if (source !== module) return false;
			if (name !== '*' && !changed.has(name)) return false;
			if (name === '*' && changed.size === 0) return false;

			return call === 1 || meta[name]?.kind !== 'function';
		})
	);
};

const importNextVersion = async (path: string) => {
	const namespace: unknown = await import(
		`${path}?absolute-hot=${nextTag(path)}`
	);
	if (typeof namespace !== 'object' || namespace === null)
		throw new Error(`${path} did not evaluate to a module`);

	return Object.fromEntries(Object.entries(namespace));
};

const display = (path: string) => relative(process.cwd(), path) || path;

const SLOW_UPDATE_MS = 500;
const SLOWEST_SHOWN = 3;

/** `v:routes` → `routes`; an unnamed statement reads as its position. */
const statementLabel = (id: string) => {
	const name = id.slice(id.indexOf(':') + 1);

	return /^\d+$/.test(name) ? `statement #${name}` : name;
};

/** The statements that took longest in the modules an update re-ran, so a
 *  slow update says where its time went. */
const slowestStatements = (modules: string[]) =>
	modules
		.flatMap((module) =>
			[...(moduleRecord(module)?.lastTimings ?? [])].map(
				([id, duration]) => ({
					duration,
					label: `${display(module)} ${statementLabel(id)}`
				})
			)
		)
		.sort((left, right) => right.duration - left.duration)
		.slice(0, SLOWEST_SHOWN)
		.map(({ label, duration }) => `${label} ${Math.round(duration)}ms`);

const SHOWN_STATEMENTS = 5;

/** Log an in-place re-run of the server entry: how long it took and which
 *  of its statements re-ran (the rest kept their values). */
export const reportEntryUpdate = (entryPath: string, elapsed: number) => {
	const entry = realPath(entryPath);
	const reran = [...(moduleRecord(entry)?.lastTimings.keys() ?? [])].map(
		statementLabel
	);
	const shown = reran.slice(0, SHOWN_STATEMENTS).join(', ');
	const more =
		reran.length > SHOWN_STATEMENTS
			? ` and ${reran.length - SHOWN_STATEMENTS} more`
			: '';
	console.log(
		`[hmr] server: ${display(entry)} updated in ${Math.round(elapsed)}ms${
			reran.length > 0 ? ` (re-ran: ${shown}${more})` : ''
		}`
	);
	if (elapsed >= SLOW_UPDATE_MS)
		console.log(
			`[hmr] server: slowest statements: ${slowestStatements([entry]).join(', ')}`
		);
};

/** Re-evaluate `path` as its next version and make it current. Returns the
 *  exports whose content changed, or the error that rolled it back. */
const advance = async (path: string): Promise<Advanced> => {
	const record = moduleRecord(path);
	const before: ExportMeta = { ...(record?.meta ?? {}) };
	const shapeBefore = shapeOf(record?.analysis);
	try {
		const namespace = await importNextVersion(path);
		setCurrent(path, namespace);
	} catch (error) {
		await rollback(path);

		return { error, ok: false };
	}
	const after = moduleRecord(path);
	// Exports added, removed or changed kind: later importers need the new
	// facade. Existing importers keep theirs, which still forwards to the
	// latest version.
	if (shapeOf(after?.analysis) !== shapeBefore) delete require.cache[path];

	return {
		changed: changedExports(
			before,
			after?.meta ?? {},
			after?.lastChanged ?? new Set()
		),
		ok: true
	};
};

const apply = async (
	changedPath: string,
	entryPath: string
): Promise<ServerChangeOutcome> => {
	const path = realPath(changedPath);
	const entry = realPath(entryPath);
	// The server entry has its own watcher, which re-runs it in place.
	if (path === entry) return { status: 'entry' };
	if (!moduleRecord(path) || !isHotManaged(path))
		return { status: 'unmanaged' };
	const source = readFileSync(path, 'utf-8');
	// Watchers report the same save more than once (atomic renames, the
	// rename-recovery scan): an unchanged source is already applied.
	if (moduleRecord(path)?.source === source) return { status: 'unchanged' };
	const analysis = await analyzeSource(path, source);
	if (!analysis.ok) return { status: 'unmanaged' };

	const startedAt = performance.now();
	const first = await advance(path);
	if (!first.ok) {
		reportFailure(path, first.error);

		return { error: first.error, status: 'failed' };
	}
	const propagation: Propagation = {
		entryAffected: false,
		modules: [path],
		steps: 0
	};
	const failure = await propagate(
		[{ changed: first.changed, module: path }],
		entry,
		propagation
	);
	if (failure) return failure;
	const { entryAffected, modules } = propagation;
	if (entryAffected) {
		const reloaded = await globalThis.__absoluteReloadEntry?.(
			`${display(path)} changed`
		);
		if (reloaded === false)
			return {
				error: new Error('server entry failed to re-run'),
				status: 'failed'
			};
	}
	const elapsed = Math.round(performance.now() - startedAt);
	const others = modules.slice(1).map(display);
	console.log(
		`[hmr] server: ${display(path)} updated in ${elapsed}ms${
			others.length > 0 || entryAffected
				? ` (also re-ran: ${[...others, ...(entryAffected ? [display(entry)] : [])].join(', ')})`
				: ''
		}`
	);
	if (elapsed >= SLOW_UPDATE_MS)
		console.log(
			`[hmr] server: slowest statements: ${slowestStatements([
				...modules,
				...(entryAffected ? [entry] : [])
			]).join(', ')}`
		);

	return { entry: entryAffected, modules, ms: elapsed, status: 'applied' };
};

/** Walk up from changed modules, re-running (one after another, so each
 *  sees its dependencies' new versions) the importers that used a changed
 *  export while evaluating. */
const propagate = async (
	pending: Pending[],
	entry: string,
	progress: Propagation
): Promise<ServerChangeOutcome | undefined> => {
	const [next, ...rest] = pending;
	if (!next || progress.steps >= MAX_PROPAGATION_STEPS) return undefined;
	if (next.changed.size === 0) return propagate(rest, entry, progress);
	const affected = importersOf(next.module, entry).filter((importer) => {
		progress.steps += 1;
		const analysis = moduleRecord(importer)?.analysis;
		if (!analysis || !usesChange(analysis, next.module, next.changed))
			return false;
		if (importer !== entry) return true;
		progress.entryAffected = true;

		return false;
	});
	const advanced = await affected.reduce<
		Promise<Pending[] | ServerChangeOutcome>
	>(
		(previous, importer) =>
			previous.then(async (collected) => {
				if (!Array.isArray(collected)) return collected;
				const result = await advance(importer);
				if (!result.ok) {
					reportFailure(importer, result.error);

					return { error: result.error, status: 'failed' };
				}
				progress.modules.push(importer);

				return [
					...collected,
					{ changed: result.changed, module: importer }
				];
			}),
		Promise.resolve([])
	);
	if (!Array.isArray(advanced)) return advanced;

	return propagate([...rest, ...advanced], entry, progress);
};

const reportFailure = (path: string, error: unknown) => {
	console.error(
		`[hmr] server: ${display(path)} failed to update; the previous version keeps serving.`
	);
	console.error(error);
};

// One queue for every bundle that applies edits (see `records` in runtime).

/** Apply an edit to a server module. Edits apply one at a time. */
export const applyServerChange = (path: string, entryPath: string) => {
	const previous = globalThis.__absoluteHotApplyChain ?? Promise.resolve();
	const result = previous.then(() => apply(path, entryPath));
	globalThis.__absoluteHotApplyChain = result.catch(() => undefined);

	return result;
};
