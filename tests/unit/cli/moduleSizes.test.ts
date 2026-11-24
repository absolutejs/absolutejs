import { describe, expect, test } from 'bun:test';
import {
	attributeBytes,
	decodeVlq,
	groupModules,
	groupOf
} from '../../../src/cli/scripts/moduleSizes';
import { squarify, treemapHtml } from '../../../src/cli/scripts/treemap';

/* `absolute analyze` reported totals per category — pages, hydration,
 * client, islands, shared chunks, CSS — which answers "how big" and never
 * "of what". Bun's bundler does not report what went into an output, so
 * the bytes are attributed from the sourcemap. Measured on this repo's own
 * example build, that accounts for 96.9% of a 3.9MB server bundle across
 * 1,325 sources, and found `@absolutejs/auth` owning 31% of it. */

describe('base64 VLQ', () => {
	test('decodes a single field', () => {
		expect(decodeVlq('A')).toEqual([0]);
		expect(decodeVlq('C')).toEqual([1]);
		expect(decodeVlq('D')).toEqual([-1]);
	});

	test('decodes a four-field segment', () => {
		expect(decodeVlq('AAAA')).toEqual([0, 0, 0, 0]);
	});

	/* Continuation bits: a value needing more than five bits spans
	 * several characters. */
	test('decodes a multi-character value', () => {
		expect(decodeVlq('2H')).toEqual([123]);
	});

	test('a character outside the alphabet yields nothing', () => {
		expect(decodeVlq('!')).toEqual([]);
	});
});

describe('attributing bytes to sources', () => {
	/* One generated line, two segments: the first owns columns 0-9 and
	 * the second owns the rest of the line. */
	test('a segment owns the bytes up to the next one', () => {
		const generated = `${'a'.repeat(10)}${'b'.repeat(20)}`;
		const attributed = attributeBytes(generated, {
			// col 0 → source 0; then +10 cols → source +1
			mappings: 'AAAA,UCAA',
			sources: ['first.ts', 'second.ts']
		});

		/* 10 + 20 is the whole 30-byte line: a single-line bundle has no
		 * newline to charge anyone. */
		expect(attributed.modules).toEqual([
			{ bytes: 20, source: 'second.ts' },
			{ bytes: 10, source: 'first.ts' }
		]);
		expect(attributed.unmapped).toBe(0);
	});

	/* A line with no mappings at all is the bundler's own output: a
	 * prelude, the glue between modules. Reported, not charged to a
	 * source, and not dropped — percentages that leave it out add up to
	 * more than the bundle. */
	test('an unmapped line is reported as unmapped', () => {
		const attributed = attributeBytes('var prelude = 1;\nreal();', {
			mappings: ';AAAA',
			sources: ['real.ts']
		});

		expect(attributed.unmapped).toBe(17);
		expect(attributed.modules).toEqual([{ bytes: 7, source: 'real.ts' }]);
	});

	test('bytes before the first mapping on a line are unmapped', () => {
		const attributed = attributeBytes('  indented();', {
			mappings: 'EAAA',
			sources: ['x.ts']
		});

		expect(attributed.unmapped).toBe(2);
	});

	test('the total is the real file size, not the attributed sum', () => {
		const attributed = attributeBytes('abcdefgh', {
			mappings: 'AAAA',
			sources: ['x.ts']
		});

		expect(attributed.total).toBe(8);
	});

	test('a source index past the end of the list is not a crash', () => {
		const attributed = attributeBytes('abc', {
			mappings: 'AEAA',
			sources: ['only.ts']
		});

		expect(attributed.modules[0]?.source).toBe('(unknown)');
	});
});

describe('grouping, so a report is 30 rows and not 1,325', () => {
	test('a dependency groups under its package', () => {
		expect(groupOf('../../node_modules/react-dom/cjs/react-dom.js')).toBe(
			'react-dom'
		);
	});

	test('a scoped package keeps its scope', () => {
		expect(groupOf('../node_modules/@absolutejs/auth/dist/index.js')).toBe(
			'@absolutejs/auth'
		);
	});

	/* A nested dependency belongs to the package that actually ships it,
	 * which is the last node_modules segment and not the first. */
	test('a nested dependency groups under the inner package', () => {
		expect(groupOf('node_modules/a/node_modules/b/dist/index.js')).toBe(
			'b'
		);
	});

	test('project source groups by its first two segments', () => {
		expect(groupOf('../../src/core/build.ts')).toBe('src/core');
	});

	test('sizes roll up per group, largest first', () => {
		expect(
			groupModules([
				{ bytes: 10, source: 'node_modules/left/a.js' },
				{ bytes: 5, source: 'node_modules/right/a.js' },
				{ bytes: 30, source: 'node_modules/left/b.js' }
			])
		).toEqual([
			{ bytes: 40, group: 'left' },
			{ bytes: 5, group: 'right' }
		]);
	});
});

describe('the treemap layout', () => {
	const groups: Array<{ bytes: number; group: string }> = [
		{ bytes: 500, group: 'a' },
		{ bytes: 250, group: 'b' },
		{ bytes: 125, group: 'c' },
		{ bytes: 75, group: 'd' },
		{ bytes: 50, group: 'e' }
	];
	const box: { height: number; width: number; x: number; y: number } = {
		height: 400,
		width: 600,
		x: 0,
		y: 0
	};

	/* The property that makes it a treemap rather than a picture: area in
	 * proportion to bytes. Verified in a browser on the real report too —
	 * median error 0.03 of a percentage point across 46 groups. */
	test('area is proportional to bytes', () => {
		const rects = squarify(groups, box);
		const totalArea = rects.reduce(
			(sum, one) => sum + one.width * one.height,
			0
		);
		const totalBytes = groups.reduce((sum, one) => sum + one.bytes, 0);
		for (const rect of rects) {
			const share = (rect.width * rect.height) / totalArea;
			const expected =
				(groups.find((one) => one.group === rect.group)?.bytes ?? 0) /
				totalBytes;
			expect(Math.abs(share - expected)).toBeLessThan(0.001);
		}
	});

	test('the rectangles fill the box', () => {
		const area = squarify(groups, box).reduce(
			(sum, one) => sum + one.width * one.height,
			0
		);

		expect(Math.abs(area - box.width * box.height)).toBeLessThan(1);
	});

	test('every rectangle has a positive size', () => {
		const rects = squarify(groups, box);

		expect(rects.every((one) => one.width > 0 && one.height > 0)).toBe(
			true
		);
	});

	test('nothing to lay out is not a crash', () => {
		expect(squarify([], box)).toEqual([]);
		expect(squarify([{ bytes: 0, group: 'empty' }], box)).toEqual([]);
	});
});

describe('the treemap page', () => {
	/* It has to open from a file:// path in a browser with no network,
	 * which is where a build artifact gets looked at. */
	test('carries no external reference', () => {
		const html = treemapHtml([{ bytes: 10, group: 'a' }], 'build');

		expect(html).not.toContain('http://');
		expect(html).not.toContain('https://');
		expect(html).not.toContain('<script');
	});

	test('a group name cannot inject markup', () => {
		const html = treemapHtml(
			[{ bytes: 10, group: '<img onerror=alert(1)>' }],
			'build'
		);

		expect(html).not.toContain('<img');
		expect(html).toContain('&lt;img');
	});

	test('each group gets a cell with its size on hover', () => {
		const html = treemapHtml(
			[
				{ bytes: 1024, group: 'one' },
				{ bytes: 512, group: 'two' }
			],
			'build'
		);

		expect([...html.matchAll(/<rect /gu)]).toHaveLength(2);
		expect(html).toContain('<title>one — 1 KB');
	});
});
