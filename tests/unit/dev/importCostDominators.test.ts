import { describe, expect, test } from 'bun:test';
import {
	dominatedByEdge,
	dominatedByEdges,
	reachableFrom,
	reachableWithoutEdges,
	summarizeImportSavings
} from '../../../src/dev/importCost/dominators';

/* The graph every case below is built from:
 *
 *   0 root -> 1 entry
 *   1 entry -> 2 alpha, 3 beta, 4 gamma
 *   2 alpha -> 5 shared, 6 onlyAlpha -> 7 deepAlpha
 *   3 beta  -> 5 shared
 *   0 root  -> 8 framework (loaded by the bootstrap, not by the entry)
 *
 * `shared` is the module the naive "time the first import" measurement gets
 * wrong: it is reached through both alpha and beta, so deferring either one
 * moves its cost rather than removing it. */
const EDGES = [[1, 8], [2, 3, 4], [5, 6], [5], [], [], [7], [], []];
const SELF_MS = [1, 2, 4, 8, 16, 100, 32, 64, 500];

describe('import-cost dominators', () => {
	test('reachability covers the whole graph from the root', () => {
		expect([...reachableFrom(EDGES, 0)]).toEqual([
			1, 1, 1, 1, 1, 1, 1, 1, 1
		]);
	});

	test('removing one edge only removes what it alone reached', () => {
		expect([...reachableFrom(EDGES, 0, 1, 2)]).toEqual([
			1, 1, 0, 1, 1, 1, 0, 0, 1
		]);
	});

	test('a shared module is dominated by neither of its importers', () => {
		expect(dominatedByEdge(EDGES, 0, 1, 2)).toEqual([2, 6, 7]);
		expect(dominatedByEdge(EDGES, 0, 1, 3)).toEqual([3]);
		expect(dominatedByEdge(EDGES, 0, 1, 2)).not.toContain(5);
		expect(dominatedByEdge(EDGES, 0, 1, 3)).not.toContain(5);
	});

	test('a module the root reaches independently is never attributed', () => {
		expect(dominatedByEdge(EDGES, 0, 1, 4)).toEqual([4]);
		// 8 is the framework: the bootstrap loads it, so no import owns it.
		expect(dominatedByEdge(EDGES, 0, 1, 2)).not.toContain(8);
	});

	test('savings sum only the dominated modules, never the shared ones', () => {
		const summary = summarizeImportSavings({
			candidates: [
				{ specifier: './alpha', target: 2 },
				{ specifier: './beta', target: 3 },
				{ specifier: './gamma', target: 4 }
			],
			edges: EDGES,
			entry: 1,
			root: 0,
			selfMs: SELF_MS
		});
		const [alpha, beta, gamma] = summary.candidates;

		// alpha: itself (4) + onlyAlpha (32) + deepAlpha (64). Not shared (100).
		expect(alpha?.savingMs).toBe(100);
		expect(alpha?.count).toBe(3);
		expect(beta?.savingMs).toBe(8);
		expect(gamma?.savingMs).toBe(16);
		// The shared module, the framework, the root and the entry are the base.
		expect(summary.sharedBaseMs).toBe(100 + 500 + 1 + 2);
		expect(summary.sharedBaseCount).toBe(4);
		expect(summary.totalMs).toBe(
			SELF_MS.reduce((total, value) => total + value, 0)
		);
	});

	test('deferring every import together removes the shared module too', () => {
		// `shared` (5) is reached through both alpha (2) and beta (3), so no
		// single edge dominates it — but it leaves once BOTH edges are gone.
		expect([
			...reachableWithoutEdges(EDGES, 0, 1, new Set([2, 3, 4]))
		]).toEqual([1, 1, 0, 0, 0, 0, 0, 0, 1]);
		expect(
			dominatedByEdges(
				EDGES,
				0,
				1,
				new Set([2, 3, 4]),
				reachableFrom(EDGES, 0)
			)
		).toEqual([2, 3, 4, 5, 6, 7]);
	});

	test('the combined saving exceeds the sum of the per-import savings', () => {
		const summary = summarizeImportSavings({
			candidates: [
				{ specifier: './alpha', target: 2 },
				{ specifier: './beta', target: 3 },
				{ specifier: './gamma', target: 4 }
			],
			edges: EDGES,
			entry: 1,
			root: 0,
			selfMs: SELF_MS
		});
		const rowTotal = summary.candidates.reduce(
			(total, candidate) => total + candidate.savingMs,
			0
		);

		// Rows alone: alpha 100 + beta 8 + gamma 16 = 124.
		expect(rowTotal).toBe(124);
		// Together they also take `shared` (100): 124 + 100 = 224.
		expect(summary.combined.savingMs).toBe(224);
		expect(summary.combined.count).toBe(6);
		// The framework (500) is reached by the root, so it never leaves.
		expect(summary.combined.savingMs).toBeLessThan(summary.totalMs);
	});

	test('an import whose module never loaded claims nothing', () => {
		const summary = summarizeImportSavings({
			candidates: [{ specifier: 'node:fs', target: -1 }],
			edges: EDGES,
			entry: 1,
			root: 0,
			selfMs: SELF_MS
		});

		expect(summary.candidates[0]?.savingMs).toBe(0);
		expect(summary.candidates[0]?.count).toBe(0);
	});

	test('two imports of the same module save nothing on their own', () => {
		// Both entry edges point at 2; removing one leaves the other.
		const edges = [[1], [2, 2], []];
		const summary = summarizeImportSavings({
			candidates: [
				{ specifier: './same', target: 2 },
				{ specifier: './same-again', target: 2 }
			],
			edges,
			entry: 1,
			root: 0,
			selfMs: [0, 0, 50]
		});

		expect(summary.candidates.map((row) => row.savingMs)).toEqual([0, 0]);
		expect(summary.attributedMs).toBe(0);
		expect(summary.sharedBaseMs).toBe(50);
	});
});
