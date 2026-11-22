import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCodeFrame } from '../../../src/dev/codeFrame';
import { editorArgs, editorCommand } from '../../../src/dev/openInEditor';

/* The overlay printed `file:line:column` as text with, at most, the single
 * line Bun's `BuildMessage.position` carries. One line with no number is
 * often the least informative line in the file — `}` or `);` — and there
 * is nothing to count columns from. */

const roots: string[] = [];

const fileWith = (lines: readonly string[]) => {
	const root = mkdtempSync(join(tmpdir(), 'absolute-frame-'));
	roots.push(root);
	const path = join(root, 'source.ts');
	writeFileSync(path, `${lines.join('\n')}\n`);

	return path;
};

afterAll(() => {
	for (const root of roots) rmSync(root, { force: true, recursive: true });
});

describe('readCodeFrame', () => {
	const ten = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`);

	test('returns the error line with context on both sides', () => {
		const frame = readCodeFrame(fileWith(ten), { line: 5 });

		expect(frame?.lines.map((entry) => entry.number)).toEqual([
			3, 4, 5, 6, 7
		]);
		expect(frame?.lines.map((entry) => entry.text)).toEqual([
			'line 3',
			'line 4',
			'line 5',
			'line 6',
			'line 7'
		]);
	});

	test('marks exactly one line as the error', () => {
		const frame = readCodeFrame(fileWith(ten), { line: 5 });
		const flagged = frame?.lines.filter((entry) => entry.isError) ?? [];

		expect(flagged.length).toBe(1);
		expect(flagged[0]?.number).toBe(5);
	});

	/* Measured against Bun rather than assumed: for `const b = ;` Bun
	 * reports `column: 11` for the `;`, which is at zero-based index 10.
	 * An off-by-one here puts the caret under the wrong character, which
	 * is worse than no caret. */
	test('converts Bun’s one-based column to a zero-based caret', () => {
		const frame = readCodeFrame(fileWith(['const b = ;']), {
			column: 11,
			line: 1
		});

		expect(frame?.lines[0]?.caretColumn).toBe(10);
	});

	test('clamps the window at the start of the file', () => {
		const frame = readCodeFrame(fileWith(ten), { line: 1 });

		expect(frame?.lines.map((entry) => entry.number)).toEqual([1, 2, 3]);
	});

	test('clamps the window at the end of the file', () => {
		const frame = readCodeFrame(fileWith(ten), { line: 10 });

		expect(frame?.lines.map((entry) => entry.number)).toEqual([8, 9, 10]);
	});

	/* An error overlay that throws while describing an error reports
	 * neither, so every one of these is a null rather than a throw. */
	test('returns null for a file it cannot read', () => {
		expect(readCodeFrame('/nope/missing.ts', { line: 3 })).toBeNull();
	});

	test('returns null for a line past the end of the file', () => {
		expect(readCodeFrame(fileWith(ten), { line: 99 })).toBeNull();
	});

	test('returns null without a line, since there is nothing to centre on', () => {
		expect(readCodeFrame(fileWith(ten), {})).toBeNull();
	});

	/* A minified bundle is one enormous line. Printing all of it helps
	 * nobody and wedges the overlay's layout. */
	test('truncates an enormous line', () => {
		const frame = readCodeFrame(fileWith(['x'.repeat(5_000)]), { line: 1 });
		const [only] = frame?.lines ?? [];

		expect(only?.text.length).toBeLessThan(500);
		expect(only?.text.endsWith('…')).toBe(true);
	});
});

describe('editorArgs', () => {
	/* The reason this is a table and not one template: a `file:line:col`
	 * handed to an editor that wants `--line` opens a file with colons in
	 * its name, or nothing at all. */
	test.each([
		['code', ['-g', '/p/a.ts:12:3']],
		['cursor', ['-g', '/p/a.ts:12:3']],
		['/usr/local/bin/code', ['-g', '/p/a.ts:12:3']],
		['subl', ['/p/a.ts:12:3']],
		['nvim', ['+12', '/p/a.ts']],
		['vim', ['+12', '/p/a.ts']],
		['emacs', ['+12', '/p/a.ts']]
	])('%s', (command, expected) => {
		expect(editorArgs(command, '/p/a.ts', 12, 3)).toEqual(expected);
	});

	test('jetbrains uses --line and --column', () => {
		expect(editorArgs('webstorm', '/p/a.ts', 12, 3)).toEqual([
			'--line',
			'12',
			'--column',
			'3',
			'/p/a.ts'
		]);
	});

	/* Windows installs these as `code.cmd`. */
	test('matches a .cmd wrapper', () => {
		expect(editorArgs('code.cmd', '/p/a.ts', 12, undefined)).toEqual([
			'-g',
			'/p/a.ts:12'
		]);
	});

	/* An unknown editor gets the path alone — every editor understands
	 * that, where a guessed flag might open garbage. */
	test('an unknown editor gets only the path', () => {
		expect(editorArgs('my-editor', '/p/a.ts', 12, 3)).toEqual(['/p/a.ts']);
	});

	test('omits a line nobody supplied', () => {
		expect(editorArgs('code', '/p/a.ts', undefined, undefined)).toEqual([
			'-g',
			'/p/a.ts'
		]);
	});
});

describe('editorCommand', () => {
	/* ABSOLUTE_EDITOR wins so it can be set for one project without
	 * disturbing $EDITOR, which also drives git. */
	test('prefers ABSOLUTE_EDITOR over EDITOR', () => {
		const previous: Record<string, string | undefined> = {
			ABSOLUTE_EDITOR: process.env.ABSOLUTE_EDITOR,
			EDITOR: process.env.EDITOR
		};
		try {
			process.env.ABSOLUTE_EDITOR = 'mine';
			process.env.EDITOR = 'theirs';
			expect(editorCommand()).toBe('mine');

			delete process.env.ABSOLUTE_EDITOR;
			expect(editorCommand()).toBe('theirs');
		} finally {
			Object.assign(process.env, previous);
			if (previous.ABSOLUTE_EDITOR === undefined)
				delete process.env.ABSOLUTE_EDITOR;
		}
	});
});
