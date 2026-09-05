/* Turns the recorder's raw event log into the printed report.
 *
 * Runs after the user's entry has finished importing, with recording already
 * switched off, so none of the work here — re-reading sources, resolving
 * specifiers, loading the TypeScript compiler — lands in the measurement. */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { analyzeEntryImports } from './deferability';
import { summarizeImportSavings, type ImportCandidate } from './dominators';
import {
	formatImportCostReport,
	type ImportCostReport,
	type ImportCostRow
} from './format';
import { buildStaticEdges, inferDynamicEdges } from './moduleGraph';
import type { ImportCostRecorder } from './recorder';
import { computeSelfTimes, type SelfTimes } from './selfTimes';

const NOT_FOUND = -1;

const NO_DATA =
	'\n[absolute] import cost: nothing was recorded. The dev child was not preloaded with the import-cost plugin.\n';

const linkEdge = (edges: number[][], fromIndex: number, toIndex: number) => {
	const targets = edges[fromIndex];
	if (targets === undefined || fromIndex === toIndex) return;
	if (!targets.includes(toIndex)) targets.push(toIndex);
};

const resolveTarget = (
	specifier: string,
	fromDirectory: string,
	indexes: ReadonlyMap<string, number>
) => {
	try {
		return (
			indexes.get(Bun.resolveSync(specifier, fromDirectory)) ?? NOT_FOUND
		);
	} catch {
		return NOT_FOUND;
	}
};

const readEntrySource = (paths: readonly string[]) => {
	for (const path of paths) {
		const text = readSource(path);
		if (text !== null) return text;
	}

	return null;
};

const readSource = (path: string) => {
	try {
		return readFileSync(path, 'utf8');
	} catch {
		return null;
	}
};

/* The dev bootstrap is the process root, but it is not always instrumentable
   itself — it ships inside `@absolutejs/absolute`, whose manifest does not
   declare `"type": "module"`. Give it an index anyway: rooting reachability
   above the entry is what keeps anything the bootstrap loads on its own (the
   framework runtime, the boot prebuild) out of the entry's imports. */
const rootIndexOf = (recorder: ImportCostRecorder) => {
	const known = moduleIndexOf(recorder, recorder.rootModule);
	if (known !== NOT_FOUND) return known;
	const created = recorder.moduleIds.length;
	recorder.moduleIds.push(recorder.rootModule ?? '<dev bootstrap>');

	return created;
};

const moduleIndexOf = (recorder: ImportCostRecorder, path: string | null) =>
	path === null ? NOT_FOUND : (recorder.moduleIndexes.get(path) ?? NOT_FOUND);

/* Anything that loaded without a recorded importer was pulled in by code this
   diagnostic cannot see. Hanging it off the root keeps it reachable — so its
   time is counted — while making it impossible for any single import of the
   entry to claim it. */
const linkOrphansToRoot = (edges: number[][], root: number) => {
	const imported = new Uint8Array(edges.length);
	for (const targets of edges) {
		for (const target of targets) imported[target] = 1;
	}
	for (let index = 0; index < edges.length; index += 1) {
		if (imported[index] === 1 || index === root) continue;
		linkEdge(edges, root, index);
	}
};

/* Parse time is measured from the gap between one module's load and the
   next one's. That gap is honest only when everything the module imports was
   itself instrumented — otherwise Bun spent part of it loading and parsing a
   CommonJS subtree that has no events of its own, and that subtree is very
   often shared. Dropping those modules' parse time understates their cost;
   keeping it would let an import claim a saving that deferring does not
   deliver, which is the one thing this diagnostic must never do. */
const creditableSelfMs = (
	times: SelfTimes,
	hasUninstrumentedImports: Uint8Array
) =>
	times.evalMs.map((value, index) =>
		hasUninstrumentedImports[index] === 1
			? value
			: value + (times.parseMs[index] ?? 0)
	);

const buildReport = (recorder: ImportCostRecorder) => {
	const { events, moduleIds, moduleIndexes } = recorder;
	const entry = moduleIndexOf(recorder, recorder.entryModule);
	if (moduleIds.length === 0 || entry === NOT_FOUND) return NO_DATA;
	const root = rootIndexOf(recorder);
	const entryPath =
		recorder.entryOriginalModule ?? recorder.entryModule ?? '';
	const source = readEntrySource([entryPath, recorder.entryModule ?? '']);
	if (source === null) return NO_DATA;
	const times = computeSelfTimes(events, moduleIds.length);
	const { edges, hasUninstrumentedImports } = buildStaticEdges(moduleIds);
	while (edges.length < moduleIds.length) edges.push([]);
	const selfMs = creditableSelfMs(times, hasUninstrumentedImports);
	linkEdge(edges, root, entry);
	for (const [importer, imported] of inferDynamicEdges(edges, events, root)) {
		linkEdge(edges, importer, imported);
	}
	linkOrphansToRoot(edges, root);
	const declared = analyzeEntryImports(source, entryPath).filter(
		(item) => item.verdict !== 'type-only'
	);
	const fromDirectory = dirname(recorder.entryModule ?? entryPath);
	const candidates = declared.map((item) => {
		const candidate: ImportCandidate = {
			specifier: item.specifier,
			target: resolveTarget(item.specifier, fromDirectory, moduleIndexes)
		};

		return candidate;
	});
	const savings = summarizeImportSavings({
		candidates,
		edges,
		entry,
		groupSpecifiers: new Set(
			candidates
				.filter(
					(_candidate, index) =>
						(declared[index]?.verdict ?? 'deferrable') ===
						'deferrable'
				)
				.map((candidate) => candidate.specifier)
		),
		root,
		selfMs
	});
	const loadedMs = times.selfMs.reduce((total, value) => total + value, 0);
	const rootMs = selfMs[root] ?? 0;
	const entryMs = selfMs[entry] ?? 0;
	const rows: ImportCostRow[] = savings.candidates
		.map((saving, index) => ({
			count: saving.count,
			savingMs: saving.savingMs,
			specifier: saving.specifier,
			verdict: declared[index]?.verdict ?? 'deferrable'
		}))
		.sort((left, right) => right.savingMs - left.savingMs);
	const report: ImportCostReport = {
		combinedCount: savings.combined.count,
		combinedMs: savings.combined.savingMs,
		entryBodyMs: entryMs,
		entryLabel: relative(process.cwd(), entryPath) || entryPath,
		// The root is still on the stack: the report runs from inside it.
		incomplete: times.incomplete.filter((index) => index !== root).length,
		interleaved: times.interleaved,
		moduleCount: savings.reachableCount - 2,
		outsideMs: loadedMs - savings.totalMs + rootMs + times.unownedMs,
		overheadMs: times.overheadMs,
		rows,
		sharedBaseCount: savings.sharedBaseCount - 2,
		sharedBaseMs: savings.sharedBaseMs - rootMs - entryMs,
		totalMs: savings.totalMs - rootMs - entryMs
	};

	return formatImportCostReport(report);
};

/** `ABSOLUTE_DEV_IMPORT_COST_DUMP=<path>` writes the raw measurement next to
 *  the report, so an attribution can be re-derived without another boot. */
const dumpRecorder = (recorder: ImportCostRecorder) => {
	const path = process.env.ABSOLUTE_DEV_IMPORT_COST_DUMP;
	if (path === undefined) return;
	writeFileSync(
		path,
		JSON.stringify({
			entryModule: recorder.entryModule,
			entryOriginalModule: recorder.entryOriginalModule,
			events: recorder.events,
			moduleIds: recorder.moduleIds,
			rootModule: recorder.rootModule
		})
	);
};

/** Prints the report. Never throws: a diagnostic must not be able to take a
 *  boot down. */
export const reportImportCost = () => {
	const recorder = globalThis.__absoluteImportCost;
	if (recorder === undefined) return;
	recorder.recording = false;
	try {
		dumpRecorder(recorder);
		console.log(buildReport(recorder));
	} catch (error) {
		console.error(
			`[absolute] import-cost report failed: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
	}
};
