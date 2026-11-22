/* A code frame for an error the dev server reports.
 *
 * Bun's `BuildMessage.position` gives `line`, `column` and `lineText` —
 * one line. The overlay rendered exactly that: the offending line on its
 * own, with no numbers and nothing around it. A one-line excerpt is often
 * the least useful line in the file (`}` or `);`), and with no line
 * numbers there is nothing to count from.
 *
 * Reading the surrounding lines has to happen here rather than in the
 * browser: the overlay cannot read the filesystem, and by the time a
 * transform has failed there is no module to serve it from either. */

import { readFileSync } from 'node:fs';

const DEFAULT_CONTEXT_LINES = 2;
const MAX_LINE_LENGTH = 400;
const FIRST_LINE = 1;

export type CodeFrameLine = {
	/** Zero-based column the error points at; only on the offending
	 *  line. */
	caretColumn?: number;
	/** True for the line the error is on. */
	isError: boolean;
	/** One-based line number as it appears in the file. */
	number: number;
	text: string;
};

export type CodeFrame = {
	lines: CodeFrameLine[];
};

/* A minified bundle or a data URI is one enormous line; printing 400
 * columns of it helps nobody and wedges the overlay's layout. */
const clamp = (text: string) =>
	text.length > MAX_LINE_LENGTH ? `${text.slice(0, MAX_LINE_LENGTH)}…` : text;

export type ReadCodeFrameOptions = {
	/** Lines of context on each side. Default 2, so a five-line frame. */
	contextLines?: number;
	/** One-based column, as Bun reports it. Measured rather than assumed:
	 *  for `const b = ;` Bun reports `column: 11` for the `;`, which sits
	 *  at zero-based index 10. */
	column?: number;
	/** One-based line, as Bun reports it. */
	line?: number;
};

/** The lines around `line` in `file`, or null when the file cannot be read
 *  or the line is not in it. Returns data; the overlay renders it.
 *
 *  Never throws: an error overlay that fails while describing an error
 *  reports neither. */
export const readCodeFrame = (
	file: string,
	{ column, contextLines = DEFAULT_CONTEXT_LINES, line }: ReadCodeFrameOptions
): CodeFrame | null => {
	if (line === undefined || line < FIRST_LINE) return null;
	let source: string;
	try {
		source = readFileSync(file, 'utf-8');
	} catch {
		return null;
	}
	const split = source.split('\n');
	/* A file ending in a newline splits to a trailing empty string, which
	 * is not a line: left in, a frame at the end of the file shows a
	 * phantom blank line and `line` one past the end is accepted. */
	const all =
		split.length > 1 && split.at(-1) === '' ? split.slice(0, -1) : split;
	if (line > all.length) return null;

	const from = Math.max(FIRST_LINE, line - contextLines);
	const last = Math.min(all.length, line + contextLines);
	const lines: CodeFrameLine[] = [];
	for (let number = from; number <= last; number += 1) {
		const isError = number === line;
		lines.push({
			...(isError && column !== undefined
				? { caretColumn: Math.max(0, column - FIRST_LINE) }
				: {}),
			isError,
			number,
			text: clamp(all[number - FIRST_LINE] ?? '')
		});
	}

	return { lines };
};
