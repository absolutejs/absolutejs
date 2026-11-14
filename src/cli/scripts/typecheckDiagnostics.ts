import { resolve } from 'node:path';
import { ANSI_ESCAPE_CODE } from '../../constants';

/* Reading the diagnostics a checker printed, so two checkers that read the
 * same files don't both report the same error.
 *
 * In a project with Vue, `absolute typecheck` runs two TypeScript programs
 * over the server code: the plain one (bun check or tsc), which resolves
 * `.svelte` imports to their generated declarations, and the Vue one
 * (vue-check or vue-tsc), which resolves `.vue` imports to their real
 * component types. An error neither framework touches (a React prop, a
 * plain TypeScript mistake) is in both programs, and is reported once, by
 * the plain checker. */

const ANSI_COLOR_REGEX = new RegExp(
	`${String.fromCharCode(ANSI_ESCAPE_CODE)}\\[[0-9;]*m`,
	'g'
);

const stripAnsi = (text: string) => text.replace(ANSI_COLOR_REGEX, '');

/* Every shape a checker prints a positioned diagnostic in:
 *   file(1,7): error TS2322: …            tsc/bun check --pretty=false, vue-check
 *   file:1:7 - error TS2322: …            tsc/vue-tsc --pretty
 *   <error file="f" line="1" column="7" code="TS2322">   bun check, piped */
const PAREN_FORMAT = /^(.+?)\((\d+),(\d+)\): error (TS\d+)/;
const COLON_FORMAT = /^(.+?):(\d+):(\d+) - error (TS\d+)/;
const XML_FORMAT =
	/^<error file="([^"]+)" line="(\d+)" column="(\d+)" code="(TS\d+)">/;
/*   error: TS2322: …                      bun check --pretty=true
 *       at file:1:7                       (the position follows the message) */
const PRETTY_CODE = /^error: (TS\d+): /;
const PRETTY_POSITION = /^\s+at (.+):(\d+):(\d+)$/;
const FORMATS = [PAREN_FORMAT, COLON_FORMAT, XML_FORMAT];

type Position = { code: string; column: string; file: string; line: string };

const keyOf = ({ code, column, file, line }: Position, cwd: string) =>
	`${resolve(cwd, file)}:${line}:${column}:${code}`;

const matchPosition = (line: string) => {
	for (const format of FORMATS) {
		const match = format.exec(line);
		if (!match) continue;
		const [, file = '', row = '', column = '', code = ''] = match;

		return { code, column, file, line: row };
	}

	return null;
};

const prettyKeys = (lines: string[], cwd: string) =>
	lines.flatMap((line, index) => {
		const code = PRETTY_CODE.exec(line)?.[1];
		if (code === undefined) return [];
		const position = lines
			.slice(index + 1)
			.map((next) => PRETTY_POSITION.exec(next))
			.find((match) => match !== null);
		if (!position) return [];
		const [, file = '', row = '', column = ''] = position;

		return [keyOf({ code, column, file, line: row }, cwd)];
	});

/** The positioned errors in a checker's output, as `file:line:column:code`
 *  keys (file resolved against `cwd`). */
export const diagnosticKeys = (output: string, cwd = process.cwd()) => {
	const lines = stripAnsi(output).split('\n');
	const keys = lines.flatMap((line) => {
		const position = matchPosition(line);

		return position ? [keyOf(position, cwd)] : [];
	});

	return new Set([...keys, ...prettyKeys(lines, cwd)]);
};

const SUMMARY_LINES = [
	/^Found \d+ errors?/,
	/^Errors\s+Files$/,
	/^\s+\d+\s+\S.*:\d+$/
];

const isSummary = (line: string) =>
	SUMMARY_LINES.some((pattern) => pattern.test(stripAnsi(line)));

type Block = { key: string | null; lines: string[] };

const toBlocks = (output: string, cwd: string) =>
	output.split('\n').reduce<Block[]>((blocks, line) => {
		const position = matchPosition(stripAnsi(line));
		const last = blocks[blocks.length - 1];
		if (position) blocks.push({ key: keyOf(position, cwd), lines: [line] });
		else if (last) last.lines.push(line);
		else blocks.push({ key: null, lines: [line] });

		return blocks;
	}, []);

/**
 * A checker's output without the errors another checker already reported.
 * Only positioned errors are matched; anything else the checker printed
 * (a crash, a config error, its own notes) is kept, and so is its failure.
 *
 * Returns the remaining output and how many errors it still holds. A
 * checker whose every error was a duplicate passed: everything it found is
 * already on screen under the other checker's name.
 */
export const withoutReported = (
	output: string,
	reported: ReadonlySet<string>,
	cwd = process.cwd()
) => {
	const blocks = toBlocks(output, cwd);
	const kept = blocks.filter(
		(block) => block.key === null || !reported.has(block.key)
	);
	const remaining = kept.filter((block) => block.key !== null).length;
	const dropped = blocks.length - kept.length;
	const lines = kept
		.flatMap((block) => block.lines)
		.filter((line) => dropped === 0 || !isSummary(line));

	return {
		dropped,
		output: lines.join('\n').trim(),
		remaining
	};
};
