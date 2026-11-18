import { describe, expect, test } from 'bun:test';
import ts from 'typescript';
import {
	ANALYZER_VERSION,
	analyzeModule
} from '../../../../src/dev/hot/analyze';

/* Dev servers cache each module's analysis on disk, keyed by
 * ANALYZER_VERSION. An analysis whose shape changed without the version
 * changing is read back from the old cache without the new fields, and the
 * feature built on them silently does nothing (beta.199 shipped `reaches`
 * that way). When this test fails, bump ANALYZER_VERSION, then update it. */

const analyze = (source: string) => {
	const result = analyzeModule(
		ts,
		'/virtual/outer.ts',
		source,
		(specifier) =>
			specifier === './inner' ? '/virtual/inner.ts' : undefined
	);
	if (!result.ok) throw new Error(result.reason);

	return result;
};

describe('the analysis cache version', () => {
	test('names the shape of the analysis', () => {
		const { plan } = analyze('export const one = 1;\n');

		expect({
			plan: Object.keys(plan[0] ?? {}).sort(),
			version: ANALYZER_VERSION
		}).toEqual({
			plan: [
				'always',
				'cell',
				'deps',
				'hash',
				'ids',
				'imports',
				'mutates',
				'reaches'
			],
			version: 5
		});
	});

	test("a factory's reaches cover its own calls, not its callbacks'", () => {
		const { exports, plan } = analyze(
			[
				"import { makeInner, helper } from './inner';",
				'export const makeOuter = () => ({ inner: makeInner(), handle: () => helper() });',
				''
			].join('\n')
		);
		const declared = exports.makeOuter?.plan ?? -1;

		expect(plan[declared]?.reaches).toEqual([
			['/virtual/inner.ts', 'makeInner', 1]
		]);
	});
});
