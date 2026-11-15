import { relative, resolve } from 'node:path';
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
 * the plain checker. ngc is the same: its program includes the Angular
 * directory, so an error in a component's TypeScript is in both. */

const ANSI_COLOR_REGEX = new RegExp(
	`${String.fromCharCode(ANSI_ESCAPE_CODE)}\\[[0-9;]*m`,
	'g'
);

const stripAnsi = (text: string) => text.replace(ANSI_COLOR_REGEX, '');

/* Every shape a checker prints a positioned diagnostic in:
 *   file(1,7): error TS2322: …            tsc/bun check --pretty=false, vue-check
 *   file:1:7 - error TS2322: …            tsc/vue-tsc --pretty
 *   <error file="f" line="1" column="7" code="TS2322">   bun check, piped
 * ngc prints the colon shape, and Angular's own diagnostics carry an NG
 * code (`error NG8001`); matching those keeps each one its own block, so
 * dropping a duplicate TS error never drops the NG error printed after it. */
const PAREN_FORMAT = /^(.+?)\((\d+),(\d+)\): error ((?:TS|NG)\d+)/;
const COLON_FORMAT = /^(.+?):(\d+):(\d+) - error ((?:TS|NG)\d+)/;
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

/* svelte-check, run with `--output machine-verbose`, prints one line per
 * event, each after a timestamp:
 *   1794717769312 START "/project"
 *   1794717769313 {"type":"ERROR","filename":"src/a.ts","start":{"line":0,"character":13},…,"code":2322}
 *   1794717769313 COMPLETED 373 FILES 3 ERRORS 1 WARNINGS 2 FILES_WITH_PROBLEMS
 *   1794717769313 FAILURE "message"
 * Filenames are relative to the directory it ran in, and positions are
 * 0-based (LSP), where tsc's are 1-based. A TypeScript diagnostic carries
 * its numeric code (source `ts`, `js`, or none for a plain `.ts` file); the
 * Svelte compiler's carry a string code and source `svelte`.
 *
 * svelte-check's program includes a configured svelteDirectory whole, so a
 * plain TypeScript error in a `.ts` file there is in the plain checker's
 * output too, at the same position and code. It is reported once, under
 * the plain checker; svelte-check keeps what only it sees. */

type SveltePosition = { character: number; line: number };

export type SvelteCheckDiagnostic = {
	code?: number | string;
	end: SveltePosition;
	filename: string;
	message: string;
	source?: string;
	start: SveltePosition;
	type: 'ERROR' | 'WARNING';
};

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const toPosition = (value: unknown) =>
	isObject(value) &&
	typeof value.line === 'number' &&
	typeof value.character === 'number'
		? { character: value.character, line: value.line }
		: null;

const toDiagnostic = (value: unknown): SvelteCheckDiagnostic | null => {
	if (!isObject(value)) return null;
	const { code, filename, message, source, type } = value;
	const start = toPosition(value.start);
	const end = toPosition(value.end) ?? start;
	if (
		(type !== 'ERROR' && type !== 'WARNING') ||
		typeof filename !== 'string' ||
		typeof message !== 'string' ||
		start === null ||
		end === null
	)
		return null;

	return {
		code:
			typeof code === 'number' || typeof code === 'string'
				? code
				: undefined,
		end,
		filename,
		message,
		source: typeof source === 'string' ? source : undefined,
		start,
		type
	};
};

const parseJson = (text: string) => {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
};

const parseFailure = (text: string) => {
	const parsed = parseJson(text);

	return typeof parsed === 'string' ? parsed : text;
};

const MACHINE_LINE = /^\d+ (.*)$/;
const IGNORED_EVENTS = ['START ', 'COMPLETED '];

/** svelte-check's machine-verbose output: its errors, its failures, and any
 *  other line it (or node) printed, kept verbatim. Warnings are dropped:
 *  `--threshold error` keeps them out of the output, and this keeps them
 *  out of the count if one ever gets through. */
export const parseSvelteCheckOutput = (output: string) => {
	const diagnostics: SvelteCheckDiagnostic[] = [];
	const failures: string[] = [];
	const other: string[] = [];
	for (const line of stripAnsi(output).split('\n')) {
		if (line.trim() === '') continue;
		const event = MACHINE_LINE.exec(line)?.[1] ?? '';
		const diagnostic = event.startsWith('{')
			? toDiagnostic(parseJson(event))
			: null;
		if (diagnostic?.type === 'ERROR') diagnostics.push(diagnostic);
		else if (diagnostic !== null) continue;
		else if (event.startsWith('FAILURE '))
			failures.push(parseFailure(event.slice('FAILURE '.length)));
		else if (!IGNORED_EVENTS.some((prefix) => event.startsWith(prefix)))
			other.push(line);
	}

	return { diagnostics, failures, other };
};

const TS_SOURCES = new Set([undefined, 'js', 'ts']);

const isTypeScriptDiagnostic = ({ code, source }: SvelteCheckDiagnostic) =>
	typeof code === 'number' && TS_SOURCES.has(source);

/** The `file:line:column:code` key of a TypeScript diagnostic, 1-based like
 *  the plain checker's; null for the Svelte compiler's own diagnostics,
 *  which no other checker reports. */
export const svelteDiagnosticKey = (
	diagnostic: SvelteCheckDiagnostic,
	cwd = process.cwd()
) =>
	isTypeScriptDiagnostic(diagnostic)
		? keyOf(
				{
					code: `TS${diagnostic.code}`,
					column: String(diagnostic.start.character + 1),
					file: diagnostic.filename,
					line: String(diagnostic.start.line + 1)
				},
				cwd
			)
		: null;

const codeLabel = (diagnostic: SvelteCheckDiagnostic) => {
	if (diagnostic.code === undefined) return '';
	if (isTypeScriptDiagnostic(diagnostic)) return ` TS${diagnostic.code}`;

	return ` ${diagnostic.code}`;
};

/* The offending line, with the span underlined. Tabs stay tabs on both
 * lines, so the underline sits under the span whatever the tab width. */
const codeFrame = (
	diagnostic: SvelteCheckDiagnostic,
	sourceText: string | null
) => {
	const text = sourceText?.split('\n')[diagnostic.start.line];
	if (text === undefined) return [];
	const line = text.replace(/\r$/, '');
	const { end, start } = diagnostic;
	const from = Math.min(start.character, line.length);
	const until = end.line === start.line ? end.character : line.length;
	const width = Math.max(1, Math.min(until, line.length) - from);
	const gutter = String(start.line + 1);
	const indent = line.slice(0, from).replace(/[^\t]/g, ' ');

	return [
		`\x1b[7m${gutter}\x1b[0m ${line}`,
		`\x1b[7m${' '.repeat(gutter.length)}\x1b[0m ${indent}\x1b[91m${'~'.repeat(width)}\x1b[0m`
	];
};

/** svelte-check's errors in tsc's pretty shape: `file:line:col - error
 *  TS2322: message`, then the line with the span underlined. */
export const formatSvelteDiagnostics = (
	diagnostics: readonly SvelteCheckDiagnostic[],
	readSource: (file: string) => string | null,
	cwd = process.cwd()
) => {
	const blocks = diagnostics.map((diagnostic) => {
		const absolute = resolve(cwd, diagnostic.filename);
		const file = relative(cwd, absolute) || diagnostic.filename;
		const line = diagnostic.start.line + 1;
		const column = diagnostic.start.character + 1;
		const header = `\x1b[96m${file}\x1b[0m:\x1b[93m${line}\x1b[0m:\x1b[93m${column}\x1b[0m - \x1b[91merror\x1b[0m\x1b[90m${codeLabel(diagnostic)}: \x1b[0m${diagnostic.message}`;
		const frame = codeFrame(diagnostic, readSource(absolute));

		return [header, ...(frame.length > 0 ? ['', ...frame] : [])].join('\n');
	});
	if (blocks.length === 0) return '';
	const suffix = blocks.length === 1 ? '' : 's';

	return `${blocks.join('\n\n')}\n\nFound ${blocks.length} error${suffix}.`;
};

/**
 * svelte-check's output, read and rendered for people, without the errors
 * the plain checker already reported (`reported`, from diagnosticKeys).
 * A failure or any unrecognised line is kept, and keeps the run failing.
 * `remaining` is 0 when everything svelte-check found is already on screen.
 */
export const svelteCheckReport = (
	output: string,
	reported: ReadonlySet<string>,
	readSource: (file: string) => string | null,
	cwd = process.cwd()
) => {
	const { diagnostics, failures, other } = parseSvelteCheckOutput(output);
	const kept = diagnostics.filter((diagnostic) => {
		const key = svelteDiagnosticKey(diagnostic, cwd);

		return key === null || !reported.has(key);
	});
	const sections = [
		...other,
		...failures.map(
			(failure) => `\x1b[91merror\x1b[0m svelte-check failed: ${failure}`
		),
		formatSvelteDiagnostics(kept, readSource, cwd)
	].filter((section) => section.length > 0);

	return {
		dropped: diagnostics.length - kept.length,
		output: sections.join('\n'),
		remaining: kept.length + failures.length + other.length
	};
};
