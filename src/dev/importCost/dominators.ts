/* Dominator computation over the module graph.
 *
 * The only question worth answering is "if I deferred this import, how much
 * boot time would actually go away?", and the answer is not the time spent
 * under that import — most of it is shared with other imports and stays.
 *
 * A module is *dominated by an import edge* when every path from the process
 * root to that module goes through that edge. Those, and only those, become
 * unreachable when the edge is removed, so their evaluation is what deferring
 * actually removes. Computing it by removing the edge and re-running
 * reachability is the dominator relation for a single edge, computed exactly,
 * and it costs one graph walk per candidate.
 *
 * The root is the process's first module (the dev bootstrap), not the user's
 * entry. That matters: the framework runtime is loaded by the bootstrap's own
 * boot prebuild, so it is reachable without the user's entry and correctly
 * falls into the shared base instead of being credited to whichever import
 * happened to touch it first. */

export type ImportCandidate = {
	specifier: string;
	/** Module index the specifier resolved to, or `-1` if it never loaded. */
	target: number;
};

export type ImportSaving = {
	/** Modules that become unreachable when this edge is removed. */
	count: number;
	savingMs: number;
	specifier: string;
	target: number;
};

export type ImportSavings = {
	attributedCount: number;
	attributedMs: number;
	candidates: ImportSaving[];
	reachableCount: number;
	sharedBaseCount: number;
	sharedBaseMs: number;
	totalMs: number;
};

export type SavingsInput = {
	candidates: readonly ImportCandidate[];
	edges: ReadonlyArray<readonly number[]>;
	/** Module whose top-level imports the candidates are — the user's entry. */
	entry: number;
	/** Process root (the dev bootstrap), where reachability starts. */
	root: number;
	selfMs: readonly number[];
};

const NOT_FOUND = -1;

const pushNeighbours = (
	targets: readonly number[],
	seen: Uint8Array,
	stack: number[],
	skip: number
) => {
	for (const target of targets) {
		if (target === skip) continue;
		if (seen[target] === 1) continue;
		seen[target] = 1;
		stack.push(target);
	}
};

/** The modules dominated by the edge `from -> to`: reachable from the root
 *  today, unreachable once that edge is gone. */
export const dominatedByEdge = (
	edges: ReadonlyArray<readonly number[]>,
	root: number,
	fromIndex: number,
	toIndex: number,
	reachable: Uint8Array = reachableFrom(edges, root)
) => {
	const without = reachableFrom(edges, root, fromIndex, toIndex);
	const dominated: number[] = [];
	for (let index = 0; index < edges.length; index += 1) {
		if (reachable[index] === 1 && without[index] !== 1)
			dominated.push(index);
	}

	return dominated;
};

/** Modules reachable from `root`, optionally with the single edge
 *  `skipFrom -> skipTo` removed. */
export const reachableFrom = (
	edges: ReadonlyArray<readonly number[]>,
	root: number,
	skipFrom = NOT_FOUND,
	skipTo = NOT_FOUND
) => {
	const seen = new Uint8Array(edges.length);
	if (root < 0 || root >= edges.length) return seen;
	seen[root] = 1;
	const stack = [root];
	while (stack.length > 0) {
		const current = stack.pop();
		if (current === undefined) break;
		pushNeighbours(
			edges[current] ?? [],
			seen,
			stack,
			current === skipFrom ? skipTo : NOT_FOUND
		);
	}

	return seen;
};

const sumSelfMs = (selfMs: readonly number[], indexes: readonly number[]) =>
	indexes.reduce((total, index) => total + (selfMs[index] ?? 0), 0);

type Totals = {
	attributedCount: number;
	attributedMs: number;
	reachableCount: number;
	totalMs: number;
};

const accumulate = (
	selfMs: readonly number[],
	reachable: Uint8Array,
	attributed: Uint8Array
) => {
	const totals: Totals = {
		attributedCount: 0,
		attributedMs: 0,
		reachableCount: 0,
		totalMs: 0
	};
	for (let index = 0; index < reachable.length; index += 1) {
		if (reachable[index] !== 1) continue;
		totals.reachableCount += 1;
		totals.totalMs += selfMs[index] ?? 0;
		if (attributed[index] !== 1) continue;
		totals.attributedCount += 1;
		totals.attributedMs += selfMs[index] ?? 0;
	}

	return totals;
};

const targetCounts = (candidates: readonly ImportCandidate[]) => {
	const counts = new Map<number, number>();
	for (const candidate of candidates) {
		counts.set(candidate.target, (counts.get(candidate.target) ?? 0) + 1);
	}

	return counts;
};

/* Two specifiers that resolve to the same module claim nothing: deferring
   one of them leaves the other importing it, so the modules belong in the
   shared base exactly as if two different files had imported it. */
const dominatedRows = (input: SavingsInput, reachable: Uint8Array) => {
	const counts = targetCounts(input.candidates);
	const skip = (candidate: ImportCandidate) =>
		candidate.target < 0 || (counts.get(candidate.target) ?? 0) > 1;

	return input.candidates.map((candidate) => ({
		candidate,
		dominated: skip(candidate)
			? []
			: dominatedByEdge(
					input.edges,
					input.root,
					input.entry,
					candidate.target,
					reachable
				)
	}));
};

export const summarizeImportSavings = (input: SavingsInput) => {
	const reachable = reachableFrom(input.edges, input.root);
	const attributed = new Uint8Array(input.edges.length);
	const savings: ImportSaving[] = [];
	for (const { candidate, dominated } of dominatedRows(input, reachable)) {
		for (const index of dominated) attributed[index] = 1;
		savings.push({
			count: dominated.length,
			savingMs: sumSelfMs(input.selfMs, dominated),
			specifier: candidate.specifier,
			target: candidate.target
		});
	}
	const totals = accumulate(input.selfMs, reachable, attributed);
	const result: ImportSavings = {
		attributedCount: totals.attributedCount,
		attributedMs: totals.attributedMs,
		candidates: savings,
		reachableCount: totals.reachableCount,
		sharedBaseCount: totals.reachableCount - totals.attributedCount,
		sharedBaseMs: totals.totalMs - totals.attributedMs,
		totalMs: totals.totalMs
	};

	return result;
};
