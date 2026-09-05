import { describe, expect, test } from 'bun:test';
import { importedBindingNames } from '../../../src/dev/moduleServer';

describe('importedBindingNames', () => {
	test('reads the names a plain named import asks for', () => {
		expect(importedBindingNames("import { a, b } from '")).toEqual([
			'a',
			'b'
		]);
	});

	test('an alias keeps the source name, which is what must be exported', () => {
		// `{ a as b }` fails unless the module exports `a`.
		expect(importedBindingNames("import { a as b } from '")).toEqual(['a']);
	});

	test('spans a multi-line clause', () => {
		expect(
			importedBindingNames("import {\n\tfirst,\n\tsecond\n} from '")
		).toEqual(['first', 'second']);
	});

	test('a default import needs no named exports', () => {
		expect(importedBindingNames("import thing from '")).toEqual([]);
	});

	test('a namespace import needs no named exports', () => {
		expect(importedBindingNames("import * as ns from '")).toEqual([]);
	});

	test('a default plus named import still reports the named ones', () => {
		expect(importedBindingNames("import thing, { a } from '")).toEqual([
			'a'
		]);
	});

	test('drops an inline type specifier', () => {
		expect(
			importedBindingNames("import { type Only, real } from '")
		).toEqual(['Only', 'real']);
	});

	test('ignores anything that is not an identifier', () => {
		expect(importedBindingNames("import { 'not-valid' } from '")).toEqual(
			[]
		);
	});

	test('a bare side-effect import asks for nothing', () => {
		expect(importedBindingNames("import '")).toEqual([]);
	});

	test('re-exports are covered too', () => {
		expect(importedBindingNames("export { a, b } from '")).toEqual([
			'a',
			'b'
		]);
	});
});
