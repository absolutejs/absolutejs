import { expect, test } from 'bun:test';
import { dedupeCssBlocks } from '../../../src/build/dedupeCssBlocks';

test('retains the last occurrence and intervening cascade order', () => {
	const shared = '.value { color: red; }';
	const override = '.value { color: blue; }';
	expect(dedupeCssBlocks([shared, override, shared])).toEqual([override, shared]);
});

test('preserves layer, import, namespace and escaped syntax', () => {
	for (const block of [
		'@layer first { .value { color: red; } }',
		'@LAYER first;',
		'@import "shared.css";',
		'@namespace svg url(http://www.w3.org/2000/svg);',
		String.raw`@l\61yer first;`
	]) expect(dedupeCssBlocks([block, '.value { color: blue; }', block])).toHaveLength(3);
});

test('does not mutate inputs or merge nonidentical component styles', () => {
	const blocks = ['.a[data-v-a] { color: red; }', '.a[data-v-b] { color: red; }'];
	expect(dedupeCssBlocks(blocks)).toEqual(blocks);
	expect(blocks).toHaveLength(2);
});


test('does not remove rules across an import or namespace boundary', () => {
	const rule = '.value { color: red; }';
	const blocks = [rule, '@import "shared.css";', rule];
	expect(dedupeCssBlocks(blocks)).toEqual(blocks);
});


test('comments and string values mentioning at-rules are not ordering barriers', () => {
	const block = `/* @import is documented here */ .value::after { content: "@layer example"; }`;
	expect(dedupeCssBlocks([block, '.value { color: blue; }', block])).toEqual(['.value { color: blue; }', block]);
});
