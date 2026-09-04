/* Recovers the import graph of the modules the dev child actually evaluated.
 *
 * Bun resolves static imports inside its own transpiler, so a runtime
 * `onResolve` hook never sees them (verified on Bun 1.4: only the process
 * entry and dynamic imports arrive, and dynamic imports arrive with an empty
 * importer). The graph is therefore rebuilt *after* the boot window, by
 * re-reading each loaded module and re-running Bun's import scanner over it.
 * Nothing here runs while the numbers are being measured.
 *
 * Every specifier kind the scanner reports — `import`, `require()` and
 * `import()` — becomes an edge. Including lazy edges is deliberate: a lazy
 * edge can only make a module look *more* shared than it is, which understates
 * a saving. Overstating one is the failure mode this diagnostic must not have.
 *
 * Modules with no importer at all were reached through a dynamic import whose
 * specifier was computed (the dev bootstrap loads both the framework runtime
 * and the user's entry that way). Those get one inferred edge each, from
 * whichever module's body was open when they began evaluating. */

import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { importCostLoader, type ImportCostLoader } from './instrument';
import { IMPORT_COST_EVENT, IMPORT_COST_EVENT_KINDS } from './recorder';

const EVENT_STRIDE = 2;

const transpilers = new Map<ImportCostLoader, Bun.Transpiler>();

const transpilerFor = (loader: ImportCostLoader) => {
	const existing = transpilers.get(loader);
	if (existing !== undefined) return existing;
	const created = new Bun.Transpiler({ loader });
	transpilers.set(loader, created);

	return created;
};

const scanSpecifiers = (path: string) => {
	try {
		const loader = importCostLoader(path);

		return transpilerFor(loader)
			.scanImports(readFileSync(path, 'utf8'))
			.map((entry) => entry.path);
	} catch {
		return [];
	}
};

const resolveSpecifier = (specifier: string, fromDirectory: string) => {
	try {
		return Bun.resolveSync(specifier, fromDirectory);
	} catch {
		return null;
	}
};

export type StaticGraph = {
	edges: number[][];
	/** Modules that import a file this diagnostic could not instrument — a
	 *  CommonJS dependency. Bun loads and parses those inside the gap that
	 *  would otherwise be charged to this module, so its parse time is not
	 *  its own and must not be credited to an import. */
	hasUninstrumentedImports: Uint8Array;
};

/** A bare specifier that resolves to nothing on disk: a runtime builtin, and
 *  nothing this diagnostic needs to account for. */
const BUILTIN = /^(?:node|bun|cloudflare):/;

const linkSpecifier = (
	specifier: string,
	context: LinkContext,
	index: number
) => {
	if (BUILTIN.test(specifier)) return;
	const resolved = resolveSpecifier(specifier, context.fromDirectory);
	if (resolved === null) return;
	const target = context.indexes.get(resolved);
	if (target === undefined) {
		context.hasUninstrumentedImports[index] = 1;

		return;
	}
	if (target !== index) context.targets.add(target);
};

type LinkContext = {
	fromDirectory: string;
	hasUninstrumentedImports: Uint8Array;
	indexes: ReadonlyMap<string, number>;
	targets: Set<number>;
};

/** Adjacency built from re-scanning every loaded module's source. */
export const buildStaticEdges = (moduleIds: readonly string[]) => {
	const indexes = new Map(moduleIds.map((id, index) => [id, index]));
	const hasUninstrumentedImports = new Uint8Array(moduleIds.length);
	const edges = moduleIds.map((id, index) => {
		const targets = new Set<number>();
		const context: LinkContext = {
			fromDirectory: dirname(id),
			hasUninstrumentedImports,
			indexes,
			targets
		};
		for (const specifier of scanSpecifiers(id)) {
			linkSpecifier(specifier, context, index);
		}

		return [...targets];
	});
	const graph: StaticGraph = { edges, hasUninstrumentedImports };

	return graph;
};

const markImporters = (
	edges: ReadonlyArray<readonly number[]>,
	hasImporter: Uint8Array
) => {
	for (const targets of edges) {
		for (const target of targets) hasImporter[target] = 1;
	}
};

type InferState = {
	entered: Uint8Array;
	hasImporter: Uint8Array;
	inferred: Array<[number, number]>;
	root: number;
	stack: number[];
};

const applyInferEvent = (
	state: InferState,
	kind: number,
	moduleIndex: number
) => {
	if (kind === IMPORT_COST_EVENT.exit) {
		const position = state.stack.lastIndexOf(moduleIndex);
		if (position !== -1) state.stack.length = position;

		return;
	}
	if (kind !== IMPORT_COST_EVENT.enter) return;
	const importer = state.stack[state.stack.length - 1];
	const orphan =
		state.entered[moduleIndex] !== 1 &&
		state.hasImporter[moduleIndex] !== 1 &&
		moduleIndex !== state.root &&
		importer !== undefined;
	if (orphan && importer !== undefined) {
		state.inferred.push([importer, moduleIndex]);
	}
	state.entered[moduleIndex] = 1;
	state.stack.push(moduleIndex);
};

/** One inferred edge per orphan module: the innermost module whose body was
 *  still open when the orphan started evaluating is the one that asked for it. */
export const inferDynamicEdges = (
	edges: ReadonlyArray<readonly number[]>,
	events: readonly number[],
	root: number
) => {
	const hasImporter = new Uint8Array(edges.length);
	markImporters(edges, hasImporter);
	const state: InferState = {
		entered: new Uint8Array(edges.length),
		hasImporter,
		inferred: [],
		root,
		stack: []
	};
	for (let cursor = 0; cursor + 1 < events.length; cursor += EVENT_STRIDE) {
		const code = events[cursor];
		if (code === undefined) break;
		applyInferEvent(
			state,
			code % IMPORT_COST_EVENT_KINDS,
			Math.floor(code / IMPORT_COST_EVENT_KINDS)
		);
	}

	return state.inferred;
};
