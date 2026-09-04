import { describe, expect, test } from 'bun:test';
import {
	importCostLoader,
	instrumentModuleSource
} from '../../../src/dev/importCost/instrument';
import { IMPORT_COST_EVENT } from '../../../src/dev/importCost/recorder';
import { computeSelfTimes } from '../../../src/dev/importCost/selfTimes';
import { instrumentableFilter } from '../../../src/dev/importCost/scope';

const KINDS = 4;
const event = (moduleIndex: number, kind: number, timeMs: number) => [
	moduleIndex * KINDS + kind,
	timeMs
];

describe('import-cost source transform', () => {
	test('line numbers survive the transform', () => {
		const source =
			'import { a } from "./a";\nconst b = a;\nexport { b };\n';
		const before = source.split('\n').length;

		expect(instrumentModuleSource(source, 3).split('\n').length).toBe(
			before + 1
		);
	});

	test('the enter call goes after a shebang and a directive prologue', () => {
		const source = '#!/usr/bin/env bun\n"use strict";\nconst a = 1;\n';
		const output = instrumentModuleSource(source, 7);

		expect(output.indexOf('__absoluteImportCostEnter')).toBeGreaterThan(
			output.indexOf('"use strict"')
		);
		expect(output.startsWith('#!/usr/bin/env bun\n')).toBe(true);
	});

	test('a "use client" banner keeps its place', () => {
		const output = instrumentModuleSource(
			"'use client';\nexport const a = 1;\n",
			1
		);

		expect(output.startsWith("'use client';")).toBe(true);
	});

	test('a file with no trailing newline still closes its span', () => {
		const output = instrumentModuleSource('const a = 1; // trailing', 2);

		expect(
			output.trimEnd().endsWith('__absoluteImportCostExit?.(2);')
		).toBe(true);
	});

	test('the calls are optional so a bundle that swallows them is inert', () => {
		expect(instrumentModuleSource('const a = 1;\n', 0)).toContain('?.(0)');
	});

	test('loaders follow the extension', () => {
		expect(importCostLoader('/x/a.tsx')).toBe('tsx');
		expect(importCostLoader('/x/a.mts')).toBe('ts');
		expect(importCostLoader('/x/a.mjs')).toBe('js');
	});
});

describe('import-cost instrumentation scope', () => {
	const filter = instrumentableFilter({
		cjsPrefixes: [
			'/app/node_modules/dual/dist/commonjs',
			'/app/node_modules/dual/node_modules'
		],
		esmPrefixes: [
			'/app/node_modules/@scope/esm',
			'/app/node_modules/dual',
			'/app/node_modules/plain-esm'
		]
	});

	test('app sources are instrumented', () => {
		expect(filter.test('/app/src/backend/server.ts')).toBe(true);
		expect(filter.test('/app/src/pages/Home.tsx')).toBe(true);
	});

	test('CommonJS packages are left alone', () => {
		expect(filter.test('/app/node_modules/lodash/index.js')).toBe(false);
		expect(
			filter.test('/app/node_modules/typescript/lib/typescript.js')
		).toBe(false);
	});

	test('.mjs is ESM wherever it lives, .cjs never is', () => {
		expect(filter.test('/app/node_modules/lodash/dist/index.mjs')).toBe(
			true
		);
		expect(filter.test('/app/node_modules/anything/index.cjs')).toBe(false);
		expect(filter.test('/app/src/legacy.cjs')).toBe(false);
	});

	test('declared ESM packages are instrumented', () => {
		expect(filter.test('/app/node_modules/plain-esm/dist/index.js')).toBe(
			true
		);
		expect(filter.test('/app/node_modules/@scope/esm/index.js')).toBe(true);
	});

	test('a CommonJS build inside an ESM package is excluded', () => {
		// The shape that takes Vue's compiler down: `entities` is
		// `"type": "module"` at its root and ships `dist/commonjs/` with its
		// own manifest saying otherwise.
		expect(filter.test('/app/node_modules/dual/dist/esm/decode.js')).toBe(
			true
		);
		expect(
			filter.test('/app/node_modules/dual/dist/commonjs/decode.js')
		).toBe(false);
	});

	test("an ESM package's own dependencies are somebody else's package", () => {
		expect(
			filter.test('/app/node_modules/dual/node_modules/dep/index.js')
		).toBe(false);
	});
});

describe('import-cost self times', () => {
	/* One parse phase then one evaluation phase, which is the shape Bun
	   produces: it loads and parses the whole graph before evaluating any of
	   it. Module 1 is a child of module 0. */
	const events = [
		...event(0, IMPORT_COST_EVENT.loadStart, 0),
		...event(0, IMPORT_COST_EVENT.loadEnd, 5),
		...event(1, IMPORT_COST_EVENT.loadStart, 25),
		...event(1, IMPORT_COST_EVENT.loadEnd, 27),
		...event(1, IMPORT_COST_EVENT.enter, 37),
		...event(1, IMPORT_COST_EVENT.exit, 57),
		...event(0, IMPORT_COST_EVENT.enter, 57),
		...event(0, IMPORT_COST_EVENT.exit, 67)
	];

	test('parse time lands on the module being parsed, overhead on nobody', () => {
		const times = computeSelfTimes(events, 2);

		// 5→25 is Bun parsing module 0; 27→37 is Bun parsing module 1.
		expect(times.parseMs).toEqual([20, 10]);
		// 0→5 and 25→27 are the plugin's own read-and-rewrite.
		expect(times.overheadMs).toBe(7);
	});

	test('a parent body excludes the children evaluated before it', () => {
		const times = computeSelfTimes(events, 2);

		expect(times.evalMs).toEqual([10, 20]);
		expect(times.selfMs).toEqual([30, 30]);
		expect(times.incomplete).toEqual([]);
		expect(times.interleaved).toBe(0);
	});

	test('a nested span (CommonJS require, awaited dynamic import) is subtracted', () => {
		const nested = [
			...event(0, IMPORT_COST_EVENT.enter, 0),
			...event(1, IMPORT_COST_EVENT.enter, 10),
			...event(1, IMPORT_COST_EVENT.exit, 40),
			...event(0, IMPORT_COST_EVENT.exit, 50)
		];
		const times = computeSelfTimes(nested, 2);

		expect(times.evalMs).toEqual([20, 30]);
	});

	test('a module that never exits is counted, not silently dropped', () => {
		const unfinished = [
			...event(0, IMPORT_COST_EVENT.enter, 0),
			...event(1, IMPORT_COST_EVENT.enter, 10),
			...event(0, IMPORT_COST_EVENT.exit, 50)
		];
		const times = computeSelfTimes(unfinished, 2);

		expect(times.incomplete).toEqual([]);
		expect(times.interleaved).toBe(1);
	});

	test('an empty log produces zeroes rather than NaN', () => {
		const times = computeSelfTimes([], 3);

		expect(times.selfMs).toEqual([0, 0, 0]);
		expect(times.overheadMs).toBe(0);
	});
});
