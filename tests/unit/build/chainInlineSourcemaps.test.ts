import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	buildLineRemap,
	chainBundleInlineSourcemap,
	chainExternalSourcemap,
	chainSourcemap,
	inlineLineMapComment,
	remapGeneratedLines
} from '../../../src/build/chainInlineSourcemaps';

/* The sourcemap chaining had no tests of its own beyond the worker pool
 * hand-off. Every expected value here was produced by the version of the
 * file from BEFORE it was restructured to pass the lint, so these pin
 * what it did, not what it should do. (The restructure was also compared
 * with that version on 16,000 generated maps and texts: no difference.) */

type Map = Parameters<typeof chainSourcemap>[0];

const outer: Map = {
	mappings: 'AAAA,IAAM;;EACJ,SAAS,GAAG;AACZ;CAAC,OAAAA',
	names: ['x'],
	sources: ['mid.js', null, 'plain.ts'],
	sourcesContent: ['mid', null, 'plain'],
	version: 3
};
const inner: Map = {
	mappings: ';AAEA,KAAK;;IAEH,CAAC;AAAA',
	names: [],
	sources: ['page.vue', null],
	sourcesContent: ['<template/>', null],
	version: 3
};
const before = [
	"import { ref } from 'vue';",
	'type T = number;',
	'',
	'const count = ref(0);',
	"import { computed } from 'vue'",
	'const double = computed(() => count.value * 2)',
	'export default { count, double }'
].join('\n');
const after = [
	'import { ref, computed } from "vue";',
	'const count = ref(0)',
	'const double = computed(() => count.value * 2);',
	'export default { count, double };'
].join('\n');

const inlineComment = (map: Map) =>
	`\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}`;

const directories: string[] = [];
const scratch = () => {
	const directory = mkdtempSync(join(tmpdir(), 'absolute-chain-maps-'));
	directories.push(directory);

	return directory;
};

afterEach(() => {
	for (const directory of directories.splice(0))
		rmSync(directory, { force: true, recursive: true });
});

describe('chainSourcemap', () => {
	test('follows an input file’s own map to the original source', () => {
		expect(
			chainSourcemap(outer, (path) => (path === 'mid.js' ? inner : null))
		).toEqual({
			mappings: 'ACAA,IAAM;;EDEN,SAAK,GAAA;AAAA;CAAA,OAAA',
			names: ['x'],
			sources: ['page.vue', 'mid.js', 'plain.ts'],
			sourcesContent: ['<template/>', 'mid', 'plain'],
			version: 3
		});
	});

	test('with nothing to chain through, keeps the outer attribution', () => {
		expect(chainSourcemap(outer, () => null)).toEqual({
			mappings: 'AAAA,IAAM;;EACJ,SAAS,GAAG;AACZ;CAAC,OAAA',
			names: ['x'],
			sources: ['mid.js', 'plain.ts'],
			sourcesContent: ['mid', 'plain'],
			version: 3
		});
	});

	test('rejects mappings that are not base64 VLQ', () => {
		expect(() =>
			chainSourcemap({ ...outer, mappings: 'AAAA,@' }, () => null)
		).toThrow('invalid base64 char');
	});
});

describe('buildLineRemap', () => {
	/* Vue imports collapse onto the merged one, the type-only line and
	 * the blank line have nowhere to go, and quotes and trailing
	 * semicolons do not stop a match. */
	test('finds where each line of the compiled script ended up', () => {
		expect(buildLineRemap(before, after)).toEqual([0, -1, -1, 1, 0, 2, 3]);
	});

	test('a line more than thirty lines further on is not found', () => {
		const padded = [
			...Array.from({ length: 31 }, () => 'filler();'),
			'x()'
		];

		expect(buildLineRemap('x()', padded.join('\n'))).toEqual([-1]);
		expect(buildLineRemap('x()', padded.slice(2).join('\n'))).toEqual([29]);
	});
});

describe('remapGeneratedLines', () => {
	test('moves each line’s segments to its new line, dropping the unmapped', () => {
		expect(remapGeneratedLines(outer.mappings, [2, -1, 0, 5])).toBe(
			'EACE,SAAS,GAAG;;AADd,IAAM;;;AAEJ'
		);
	});
});

describe('inlineLineMapComment', () => {
	test('writes a line-for-line map as an inline comment', () => {
		expect(inlineLineMapComment('/app/Page.vue', before, after)).toBe(
			'\n//# sourceMappingURL=data:application/json;base64,eyJtYXBwaW5ncyI6IkFBQUEsQUFJQTtBQURBO0FBRUE7QUFDQSIsIm5hbWVzIjpbXSwic291cmNlcyI6WyIvYXBwL1BhZ2UudnVlIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IHJlZiB9IGZyb20gJ3Z1ZSc7XG50eXBlIFQgPSBudW1iZXI7XG5cbmNvbnN0IGNvdW50ID0gcmVmKDApO1xuaW1wb3J0IHsgY29tcHV0ZWQgfSBmcm9tICd2dWUnXG5jb25zdCBkb3VibGUgPSBjb21wdXRlZCgoKSA9PiBjb3VudC52YWx1ZSAqIDIpXG5leHBvcnQgZGVmYXVsdCB7IGNvdW50LCBkb3VibGUgfSJdLCJ2ZXJzaW9uIjozfQ==\n'
		);
	});
});

describe('chainBundleInlineSourcemap', () => {
	const decodeInline = (text: string) => {
		const [, encoded = ''] =
			/base64,([A-Za-z0-9+/=]+)\s*$/.exec(text) ?? [];
		const map: Map = JSON.parse(
			Buffer.from(encoded, 'base64').toString('utf-8')
		);

		return map;
	};
	const bundleMap = (): Map => ({
		...outer,
		sourcesContent: [
			`intermediate();${inlineComment(inner)}`,
			null,
			'plain'
		]
	});

	test('rewrites a bundle’s inline map through its inputs’ inline maps', () => {
		const file = join(scratch(), 'bundle.js');
		writeFileSync(file, `run();${inlineComment(bundleMap())}`);

		expect(chainBundleInlineSourcemap(file)).toBe(true);

		const text = readFileSync(file, 'utf-8');
		const map = decodeInline(text);
		expect(text.startsWith('run();')).toBe(true);
		expect(map.sources).toEqual(['page.vue', 'mid.js', 'plain.ts']);
		expect(map.mappings).toBe('ACAA,IAAM;;EDEN,SAAK,GAAA;AAAA;CAAA,OAAA');
		// The key stays and the text goes, by default.
		expect(map.sourcesContent).toEqual([null, null, null]);
	});

	test('keeps the source text when asked to', () => {
		const file = join(scratch(), 'bundle.js');
		writeFileSync(file, `run();${inlineComment(bundleMap())}`);
		chainBundleInlineSourcemap(file, { sourcesContent: true });

		expect(
			decodeInline(readFileSync(file, 'utf-8')).sourcesContent?.[0]
		).toBe('<template/>');
	});

	test('leaves a bundle with no inline map alone', () => {
		const file = join(scratch(), 'plain.js');
		writeFileSync(file, 'run();\n');

		expect(chainBundleInlineSourcemap(file)).toBe(false);
		expect(readFileSync(file, 'utf-8')).toBe('run();\n');
	});
});

describe('chainExternalSourcemap', () => {
	test('rewrites a .map file in place', () => {
		const file = join(scratch(), 'bundle.js.map');
		writeFileSync(
			file,
			JSON.stringify({
				...outer,
				sourcesContent: [
					`intermediate();${inlineComment(inner)}`,
					null,
					'plain'
				]
			})
		);
		chainExternalSourcemap(file);

		expect(JSON.parse(readFileSync(file, 'utf-8')).sources).toEqual([
			'page.vue',
			'mid.js',
			'plain.ts'
		]);
	});

	test.each([
		['not JSON', 'this is not json'],
		['JSON that is not a source map', '{"version":3}']
	])('leaves a file that is %s untouched', (_what, contents) => {
		const file = join(scratch(), 'other.map');
		writeFileSync(file, contents);
		chainExternalSourcemap(file);

		expect(readFileSync(file, 'utf-8')).toBe(contents);
	});
});
