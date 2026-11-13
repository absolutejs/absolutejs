/* A small ICU MessageFormat formatter on the platform's Intl APIs.
 *
 * Supported: `{name}`, `{name, number[, integer|percent|::currency/EUR]}`,
 * `{name, date|time[, short|medium|long|full]}`,
 * `{name, plural|selectordinal, [offset:N] =N {…} one {…} other {…}}` with
 * `#`, `{name, select, a {…} other {…}}`, nesting, and apostrophe quoting
 * (`''` is a quote, `'{…}'` is literal text). Parsed messages are cached
 * per string; Intl formatters are cached per locale and options. */

import {
	getDateTimeFormat,
	getNumberFormat,
	getPluralRules
} from './intlCache';

type TextNode = { kind: 'text'; value: string };
type PoundNode = { kind: 'pound' };
type ArgumentNode = {
	kind: 'argument';
	name: string;
	format: string | undefined;
	style: string | undefined;
};
type BranchNode = {
	kind: 'plural' | 'select' | 'selectordinal';
	name: string;
	offset: number;
	options: Record<string, MessageNode[]>;
};
export type MessageNode = ArgumentNode | BranchNode | PoundNode | TextNode;

type Cursor = { source: string; index: number };
type Branches = { offset: number; options: Record<string, MessageNode[]> };

const SYNTAX_CHARS = new Set(['{', '}', '#', '|']);
const WHITESPACE = /\s/;

const isBranchKind = (
	value: string
): value is 'plural' | 'select' | 'selectordinal' =>
	value === 'plural' || value === 'select' || value === 'selectordinal';

const skipWhitespace = (cursor: Cursor) => {
	while (
		cursor.index < cursor.source.length &&
		WHITESPACE.test(cursor.source.charAt(cursor.index))
	) {
		cursor.index += 1;
	}
};

const syntaxError = (cursor: Cursor, expected: string) =>
	new SyntaxError(
		`Invalid ICU message (expected ${expected} at ${cursor.index}): ${cursor.source}`
	);

/** Read up to (not including) the first of `stops`, trimmed. */
const readToken = (cursor: Cursor, stops: string) => {
	const start = cursor.index;
	while (
		cursor.index < cursor.source.length &&
		!stops.includes(cursor.source.charAt(cursor.index))
	) {
		cursor.index += 1;
	}

	return cursor.source.slice(start, cursor.index).trim();
};

const expectChar = (cursor: Cursor, char: string) => {
	skipWhitespace(cursor);
	if (cursor.source.charAt(cursor.index) !== char)
		throw syntaxError(cursor, `"${char}"`);
	cursor.index += 1;
};

/** `'` handling: `''` → `'`; `'` before a syntax char opens a quoted run
 *  that ends at the next lone `'`; any other `'` is literal. */
const readQuoted = (cursor: Cursor, inPlural: boolean) => {
	const next = cursor.source.charAt(cursor.index + 1);
	if (next === "'") {
		cursor.index += 2;

		return "'";
	}
	const opensQuote = SYNTAX_CHARS.has(next) && (next !== '#' || inPlural);
	if (!opensQuote) {
		cursor.index += 1;

		return "'";
	}
	cursor.index += 1;
	let text = '';
	while (cursor.index < cursor.source.length) {
		const char = cursor.source.charAt(cursor.index);
		const isEscapedQuote =
			char === "'" && cursor.source.charAt(cursor.index + 1) === "'";
		if (char === "'" && !isEscapedQuote) break;
		text += char;
		cursor.index += isEscapedQuote ? 2 : 1;
	}
	cursor.index += 1;

	return text;
};

const pushText = (nodes: MessageNode[], value: string) => {
	const last = nodes[nodes.length - 1];
	if (last?.kind === 'text') {
		last.value += value;

		return;
	}
	nodes.push({ kind: 'text', value });
};

/** Read one `selector {message}` pair (or an `offset:N`) into `branches`. */
const parseBranchOption = (
	cursor: Cursor,
	kind: BranchNode['kind'],
	branches: Branches
) => {
	if (cursor.index >= cursor.source.length) throw syntaxError(cursor, '"}"');
	const selector = readToken(cursor, '{} \n\t\r');
	const offsetMatch = /^offset:(\d+)$/.exec(selector);
	if (offsetMatch && kind !== 'select') {
		branches.offset = Number(offsetMatch[1]);
		skipWhitespace(cursor);

		return;
	}
	if (selector === '') throw syntaxError(cursor, 'a selector');
	expectChar(cursor, '{');
	branches.options[selector] = parseNodes(cursor, kind !== 'select');
	expectChar(cursor, '}');
	skipWhitespace(cursor);
};

const parseBranchOptions = (cursor: Cursor, kind: BranchNode['kind']) => {
	const branches: Branches = { offset: 0, options: {} };
	skipWhitespace(cursor);
	while (cursor.source.charAt(cursor.index) !== '}') {
		parseBranchOption(cursor, kind, branches);
	}
	if (branches.options.other === undefined)
		throw syntaxError(cursor, 'an "other" branch');

	return branches;
};

const parseArgument = (cursor: Cursor): MessageNode => {
	skipWhitespace(cursor);
	const name = readToken(cursor, ',}');
	if (name === '') throw syntaxError(cursor, 'an argument name');
	if (cursor.source.charAt(cursor.index) === '}') {
		cursor.index += 1;

		return { format: undefined, kind: 'argument', name, style: undefined };
	}
	cursor.index += 1;
	const format = readToken(cursor, ',}');
	if (isBranchKind(format)) {
		expectChar(cursor, ',');
		const { offset, options } = parseBranchOptions(cursor, format);
		expectChar(cursor, '}');

		return { kind: format, name, offset, options };
	}
	let style: string | undefined;
	if (cursor.source.charAt(cursor.index) === ',') {
		cursor.index += 1;
		style = readToken(cursor, '}');
	}
	expectChar(cursor, '}');

	return { format, kind: 'argument', name, style };
};

/** Consume the node starting at the cursor (not a closing `}`). */
const parseNode = (cursor: Cursor, inPlural: boolean, nodes: MessageNode[]) => {
	const char = cursor.source.charAt(cursor.index);
	if (char === '{') {
		cursor.index += 1;
		nodes.push(parseArgument(cursor));

		return;
	}
	if (char === '#' && inPlural) {
		cursor.index += 1;
		nodes.push({ kind: 'pound' });

		return;
	}
	if (char === "'") {
		pushText(nodes, readQuoted(cursor, inPlural));

		return;
	}
	pushText(nodes, char);
	cursor.index += 1;
};

const parseNodes = (cursor: Cursor, inPlural: boolean) => {
	const nodes: MessageNode[] = [];
	while (
		cursor.index < cursor.source.length &&
		cursor.source.charAt(cursor.index) !== '}'
	) {
		parseNode(cursor, inPlural, nodes);
	}

	return nodes;
};

/** Parse an ICU message into nodes. Throws `SyntaxError` on bad syntax. */
export const parseMessage = (source: string) => {
	const cursor: Cursor = { index: 0, source };
	const nodes = parseNodes(cursor, false);
	if (cursor.index < source.length)
		throw syntaxError(cursor, 'end of message');

	return nodes;
};

const parsedCache = new Map<string, MessageNode[] | SyntaxError>();

const parseCached = (source: string) => {
	const cached = parsedCache.get(source);
	if (cached) return cached;
	let parsed: MessageNode[] | SyntaxError;
	try {
		parsed = parseMessage(source);
	} catch (error) {
		parsed =
			error instanceof SyntaxError
				? error
				: new SyntaxError(String(error));
	}
	parsedCache.set(source, parsed);

	return parsed;
};

const INTEGER_OPTIONS: Intl.NumberFormatOptions = { maximumFractionDigits: 0 };
const PERCENT_OPTIONS: Intl.NumberFormatOptions = { style: 'percent' };

const numberOptions = (style: string | undefined) => {
	if (style === 'integer') return INTEGER_OPTIONS;
	if (style === 'percent') return PERCENT_OPTIONS;
	const currency = /^::currency\/([A-Za-z]{3})$/.exec(style ?? '');
	const options: Intl.NumberFormatOptions = currency?.[1]
		? { currency: currency[1].toUpperCase(), style: 'currency' }
		: {};

	return options;
};

const toDate = (value: unknown) => {
	if (value instanceof Date) return value;
	if (typeof value === 'number' || typeof value === 'string')
		return new Date(value);

	return undefined;
};

const dateStyleOf = (style: string | undefined) => {
	if (style === 'full' || style === 'long' || style === 'short') return style;

	return 'medium';
};

const formatDateArgument = (
	locale: string,
	value: unknown,
	format: 'date' | 'time',
	style: string | undefined
) => {
	const date = toDate(value);
	if (!date || Number.isNaN(date.getTime())) return String(value);
	const resolvedStyle = dateStyleOf(style);
	const options: Intl.DateTimeFormatOptions =
		format === 'date'
			? { dateStyle: resolvedStyle }
			: { timeStyle: resolvedStyle };

	return getDateTimeFormat(locale, options).format(date);
};

const formatValue = (locale: string, value: unknown) => {
	if (typeof value === 'number' || typeof value === 'bigint')
		return getNumberFormat(locale).format(value);
	if (value instanceof Date) return getDateTimeFormat(locale).format(value);

	return String(value);
};

const formatArgument = (
	locale: string,
	node: ArgumentNode,
	params: Record<string, unknown>
) => {
	if (!(node.name in params)) return `{${node.name}}`;
	const value = params[node.name];
	if (node.format === 'number') {
		const numeric = typeof value === 'bigint' ? value : Number(value);

		return getNumberFormat(locale, numberOptions(node.style)).format(
			numeric
		);
	}
	if (node.format === 'date' || node.format === 'time')
		return formatDateArgument(locale, value, node.format, node.style);

	return formatValue(locale, value);
};

const selectBranch = (locale: string, node: BranchNode, value: unknown) => {
	if (node.kind === 'select') {
		return node.options[String(value)] ?? node.options.other ?? [];
	}
	const numeric = Number(value);
	const exact = node.options[`=${numeric}`];
	if (exact) return exact;
	const category = getPluralRules(locale, {
		type: node.kind === 'selectordinal' ? 'ordinal' : 'cardinal'
	}).select(numeric - node.offset);

	return node.options[category] ?? node.options.other ?? [];
};

const formatNodes = (
	locale: string,
	nodes: MessageNode[],
	params: Record<string, unknown>,
	pound: string | undefined
): string =>
	nodes
		.map((node) => {
			if (node.kind === 'text') return node.value;
			if (node.kind === 'pound') return pound ?? '#';
			if (node.kind === 'argument')
				return formatArgument(locale, node, params);
			if (!(node.name in params)) return `{${node.name}}`;
			const value = params[node.name];
			const branch = selectBranch(locale, node, value);
			const branchPound =
				node.kind === 'select'
					? pound
					: getNumberFormat(locale).format(
							Number(value) - node.offset
						);

			return formatNodes(locale, branch, params, branchPound);
		})
		.join('');

/** Format an ICU message for `locale`. A message that fails to parse is
 *  returned as written; a missing parameter renders as `{name}`. */
export const formatMessage = (
	locale: string,
	message: string,
	params: Record<string, unknown> = {}
) => {
	if (!message.includes('{') && !message.includes("'")) return message;
	const parsed = parseCached(message);
	if (parsed instanceof SyntaxError) return message;

	return formatNodes(locale, parsed, params, undefined);
};
