import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	buildStaticEdges,
	inferDynamicEdges
} from '../../../src/dev/importCost/moduleGraph';
import { IMPORT_COST_EVENT } from '../../../src/dev/importCost/recorder';

const KINDS = 4;
const event = (moduleIndex: number, kind: number, timeMs: number) => [
	moduleIndex * KINDS + kind,
	timeMs
];

describe('import-cost module graph', () => {
	test('static edges come from re-scanning the loaded sources', () => {
		const root = mkdtempSync(join(tmpdir(), 'import-cost-graph-'));
		writeFileSync(
			join(root, 'entry.ts'),
			'import { a } from "./a";\nimport type { T } from "./types";\nexport const use = (): T => a;\n'
		);
		writeFileSync(
			join(root, 'a.ts'),
			'const lazy = () => import("./b");\nexport const a = lazy;\n'
		);
		writeFileSync(join(root, 'b.ts'), 'export const b = 1;\n');
		writeFileSync(join(root, 'types.ts'), 'export type T = unknown;\n');
		const moduleIds = [
			join(root, 'entry.ts'),
			join(root, 'a.ts'),
			join(root, 'b.ts')
		];

		const { edges, hasUninstrumentedImports } = buildStaticEdges(moduleIds);

		// entry -> a. The type-only import is erased and never becomes an edge.
		expect(edges[0]).toEqual([1]);
		// A lazy `import()` still counts: including it can only make a module
		// look more shared, which understates a saving rather than inventing one.
		expect(edges[1]).toEqual([2]);
		expect(edges[2]).toEqual([]);
		expect([...hasUninstrumentedImports]).toEqual([0, 0, 0]);
	});

	test('a module nothing imports is attributed to whoever was evaluating', () => {
		// 0 is the root, still evaluating when 2 (the entry copy, imported with
		// a computed specifier) starts. 1 has a static importer already.
		const edges = [[], [], []];
		const events = [
			...event(0, IMPORT_COST_EVENT.enter, 0),
			...event(1, IMPORT_COST_EVENT.enter, 5),
			...event(1, IMPORT_COST_EVENT.exit, 6),
			...event(2, IMPORT_COST_EVENT.enter, 7),
			...event(2, IMPORT_COST_EVENT.exit, 8)
		];

		expect(inferDynamicEdges([[], [], []], events, 0)).toEqual([
			[0, 1],
			[0, 2]
		]);
		// With a static importer already recorded, no edge is invented.
		expect(inferDynamicEdges([[1], [], []], events, 0)).toEqual([[0, 2]]);
		expect(edges).toEqual([[], [], []]);
	});

	test('a dependency left uninstrumented is flagged, not silently dropped', () => {
		const root = mkdtempSync(join(tmpdir(), 'import-cost-external-'));
		mkdirSync(join(root, 'node_modules'));
		mkdirSync(join(root, 'node_modules', 'cjs-dep'));
		writeFileSync(
			join(root, 'node_modules', 'cjs-dep', 'package.json'),
			'{"name":"cjs-dep","version":"1.0.0","main":"index.js"}'
		);
		writeFileSync(
			join(root, 'node_modules', 'cjs-dep', 'index.js'),
			'module.exports = 1;\n'
		);
		writeFileSync(
			join(root, 'entry.ts'),
			'import dep from "cjs-dep";\nimport { readFileSync } from "node:fs";\nexport const use = [dep, readFileSync];\n'
		);

		const { edges, hasUninstrumentedImports } = buildStaticEdges([
			join(root, 'entry.ts')
		]);

		expect(edges).toEqual([[]]);
		// `node:fs` is a builtin with nothing to parse; the CommonJS package
		// is real work that happened inside this module's parse gap.
		expect([...hasUninstrumentedImports]).toEqual([1]);
	});

	test('the root itself never gets an inferred importer', () => {
		const events = [...event(0, IMPORT_COST_EVENT.enter, 0)];

		expect(inferDynamicEdges([[]], events, 0)).toEqual([]);
	});
});

describe('import-cost graph on a directory with no sources', () => {
	test('a missing file yields no edges rather than throwing', () => {
		const root = mkdtempSync(join(tmpdir(), 'import-cost-graph-missing-'));
		mkdirSync(join(root, 'nested'));

		expect(
			buildStaticEdges([join(root, 'nested', 'gone.ts')]).edges
		).toEqual([[]]);
	});
});
