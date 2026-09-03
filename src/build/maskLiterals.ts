/** Shields non-code spans from the regex/text-based import rewriters.
 *
 *  The import rewriters (rewriteClientOutputs, rewriteReactImports,
 *  rewriteImportsPlugin, the native Zig scanner, and compile's runtime-specifier
 *  rewrite) replace `from "X"` / `import "X"` / `import("X")` / `require("X")`
 *  across the whole file text. That text scan can't tell a real import from the
 *  *text* `from 'X'` sitting inside a template literal / data string (an
 *  example-code snippet a page renders) or a comment — so it rewrites the
 *  snippet's specifier too. The browser bundle then diverges from the SSR
 *  pre-render → React hydration mismatch on the code block.
 *
 *  Fix: before rewriting, replace template literals and comments with opaque
 *  placeholders, plus any string literal whose *own text* contains an
 *  import-like sequence (`from`/`import`/`require` + quote); rewrite; then
 *  restore them verbatim. A real import specifier string (e.g.
 *  "react/jsx-runtime") never contains that sequence, so it is left untouched
 *  and always gets rewritten — no matter what token precedes it. Regex literals
 *  are skipped (copied verbatim) so their contents can't be misread as
 *  strings/templates.
 *
 *  Usage: `const { masked, restore } = maskLiterals(src)`, run the existing
 *  rewriter on `masked`, then `restore(rewritten)`.
 *
 *  Performance: the scanner jumps from one interesting character (`/`, `'`,
 *  `"`, backtick) to the next with `charCodeAt` and copies the plain code in
 *  between as one slice, so the cost is proportional to the number of tokens
 *  rather than the number of characters. The regex-vs-division decision at a
 *  `/` looks backwards from that slash to the previous significant code
 *  character (or the end of the previous literal/comment/regex token), which
 *  is exactly the state the previous character-by-character scanner carried
 *  forward. A dev bundle masks at ~10× the old throughput. */

// Private-Use-Area sentinel: never appears in real source, carries no
// from/import/quote chars, so placeholders can't collide with code or be matched
// by the rewriters.
export const SENTINEL = String.fromCharCode(0xe000);

export type MaskedSource = {
	masked: string;
	restore: (rewritten: string) => string;
};

// A string literal only needs shielding when its TEXT actually contains an
// import-like sequence a rewriter could mistake for a real import — `from` /
// `import` / `require` followed (through optional whitespace/paren) by a quote.
// A genuine import specifier string (e.g. "react/jsx-runtime") never contains
// that internally, so it is left untouched and always gets rewritten. This
// replaces the old "is this string in specifier position?" heuristic, which
// mis-masked real specifiers whenever the preceding token wasn't exactly
// `from`/`import` (e.g. an intervening comment), leaving a bare specifier in one
// bundled chunk and breaking hydration.
const RISKY_STRING_CONTENT = /\b(?:from|import|require)\s*\(?\s*["'`]/;

const code = (char: string) => char.charCodeAt(0);
const SLASH = code('/');
const STAR = code('*');
const BACKSLASH = code('\\');
const BACKTICK = code('`');
const DOUBLE_QUOTE = code('"');
const SINGLE_QUOTE = code("'");
const NEWLINE = code('\n');
const CARRIAGE_RETURN = code('\r');
const TAB = code('\t');
const SPACE = code(' ');
const DOLLAR = code('$');
const OPEN_BRACE = code('{');
const CLOSE_BRACE = code('}');
const OPEN_BRACKET = code('[');
const CLOSE_BRACKET = code(']');
const CLOSE_PAREN = code(')');
const UNDERSCORE = code('_');
const DIGIT_ZERO = code('0');
const DIGIT_NINE = code('9');
const UPPER_A = code('A');
const UPPER_Z = code('Z');
const LOWER_A = code('a');
const LOWER_Z = code('z');
/** "No significant character yet" (start of file / interpolation). */
const NONE = -1;

// A `/` starts a regex literal (not division) when the previous significant
// token is one of these chars/keywords, or nothing (start of file).
const REGEX_OK_AFTER_CODE = new Set(
	[...'(,=:[!&|?{};+-*/%^~<>'].map(code)
);
const REGEX_OK_AFTER_WORD = new Set([
	'return',
	'typeof',
	'instanceof',
	'in',
	'of',
	'new',
	'delete',
	'void',
	'do',
	'else',
	'yield',
	'await',
	'case'
]);

const isIdentCode = (charCode: number) =>
	(charCode >= LOWER_A && charCode <= LOWER_Z) ||
	(charCode >= UPPER_A && charCode <= UPPER_Z) ||
	(charCode >= DIGIT_ZERO && charCode <= DIGIT_NINE) ||
	charCode === UNDERSCORE ||
	charCode === DOLLAR;

const isLetterCode = (charCode: number) =>
	(charCode >= LOWER_A && charCode <= LOWER_Z) ||
	(charCode >= UPPER_A && charCode <= UPPER_Z);

const isSpaceCode = (charCode: number) =>
	charCode === SPACE ||
	charCode === TAB ||
	charCode === CARRIAGE_RETURN ||
	charCode === NEWLINE;

const isQuoteCode = (charCode: number) =>
	charCode === DOUBLE_QUOTE || charCode === SINGLE_QUOTE;

/** src[start] is a quote → index just past the closing quote (or the end of
 *  the line for an unterminated string, or EOF). */
const endOfString = (src: string, start: number) => {
	const quote = src.charCodeAt(start);
	const len = src.length;
	let pos = start + 1;
	while (pos < len) {
		const charCode = src.charCodeAt(pos);
		if (charCode === BACKSLASH) pos += 2;
		else if (charCode === quote) return pos + 1;
		else if (charCode === NEWLINE) return pos; // unterminated guard
		else pos += 1;
	}

	return pos;
};

/** Index just past the regex flags that start at `start`. */
const endOfRegexFlags = (src: string, start: number) => {
	let pos = start;
	while (pos < src.length && isLetterCode(src.charCodeAt(pos))) pos += 1;

	return pos;
};

/** src[start] === '/' → index just past the regex literal and its flags, or
 *  -1 when a newline arrives first (then the slash was division). */
const endOfRegex = (src: string, start: number) => {
	const len = src.length;
	let pos = start + 1;
	let inClass = false;
	while (pos < len) {
		const charCode = src.charCodeAt(pos);
		if (charCode === NEWLINE) return -1;
		if (charCode === SLASH && !inClass) return endOfRegexFlags(src, pos + 1);
		if (charCode === OPEN_BRACKET) inClass = true;
		else if (charCode === CLOSE_BRACKET) inClass = false;
		pos += charCode === BACKSLASH ? 2 : 1;
	}

	return pos;
};

type InterpolationState = {
	depth: number;
	pos: number;
	/** Last significant (non-whitespace) code char inside the interpolation. */
	prevCode: number;
	/** Was the immediately previous char whitespace? */
	space: boolean;
	/** Identifier immediately preceding (through whitespace). */
	word: string;
};

const regexAllowedInInterpolation = (state: InterpolationState) =>
	state.prevCode === NONE ||
	REGEX_OK_AFTER_CODE.has(state.prevCode) ||
	REGEX_OK_AFTER_WORD.has(state.word);

/** A literal stands where a value would; not a word. */
const noteInterpolationToken = (
	state: InterpolationState,
	end: number,
	prevCode: number
) => {
	state.pos = end;
	state.prevCode = prevCode;
	state.word = '';
	state.space = false;
};

const noteInterpolationCode = (
	state: InterpolationState,
	charCode: number,
	char: string
) => {
	if (charCode === OPEN_BRACE) state.depth += 1;
	else if (charCode === CLOSE_BRACE) state.depth -= 1;
	state.pos += 1;
	if (isSpaceCode(charCode)) {
		state.space = true;

		return;
	}
	const contiguous = isIdentCode(state.prevCode) && !state.space;
	if (isIdentCode(charCode)) state.word = contiguous ? state.word + char : char;
	else state.word = '';
	state.prevCode = charCode;
	state.space = false;
};

const skipInterpolationRegex = (src: string, state: InterpolationState) => {
	const end = endOfRegex(src, state.pos);
	if (end > 0) noteInterpolationToken(state, end, CLOSE_PAREN);
	else noteInterpolationCode(state, SLASH, '/');
};

type TemplateScanner = {
	/** src index just past `${` → index just past the matching `}`. */
	interpolation: (src: string, start: number) => number;
	/** src[start] === '`' → index just past the closing backtick. */
	template: (src: string, start: number) => number;
};

// Tracks the previous significant token (prevCode/word) so a `/` inside the
// interpolation is classified as a regex literal vs division. Without regex
// handling, a regex that contains a quote — e.g. `${s.replace(/'/g, x)}` —
// is misread as a string: `endOfString` runs past the interpolation, the
// `{`/`}` depth desyncs, and the enclosing template is mis-masked to (nearly)
// EOF, swallowing every real import after it (bare-specifier bug).
const scanInterpolation = (src: string, start: number) => {
	const len = src.length;
	const state: InterpolationState = {
		depth: 1,
		pos: start,
		prevCode: NONE,
		space: false,
		word: ''
	};
	while (state.pos < len && state.depth > 0) {
		const charCode = src.charCodeAt(state.pos);
		const next = src.charCodeAt(state.pos + 1);
		if (charCode === BACKSLASH) state.pos += 2;
		else if (charCode === BACKTICK)
			noteInterpolationToken(
				state,
				templateScanner.template(src, state.pos),
				CLOSE_PAREN
			);
		else if (isQuoteCode(charCode))
			noteInterpolationToken(
				state,
				endOfString(src, state.pos),
				DOUBLE_QUOTE
			);
		else if (charCode === SLASH && next === SLASH)
			state.pos = endOfLineComment(src, state.pos);
		else if (charCode === SLASH && next === STAR)
			state.pos = endOfBlockComment(src, state.pos);
		else if (charCode === SLASH && regexAllowedInInterpolation(state))
			skipInterpolationRegex(src, state);
		else noteInterpolationCode(state, charCode, src[state.pos] ?? '');
	}

	return state.pos;
};

const scanTemplate = (src: string, start: number) => {
	const len = src.length;
	let pos = start + 1;
	while (pos < len) {
		const charCode = src.charCodeAt(pos);
		if (charCode === BACKSLASH) pos += 2;
		else if (charCode === BACKTICK) return pos + 1;
		else if (charCode === DOLLAR && src.charCodeAt(pos + 1) === OPEN_BRACE)
			pos = templateScanner.interpolation(src, pos + 2);
		else pos += 1;
	}

	return pos;
};

const templateScanner: TemplateScanner = {
	interpolation: scanInterpolation,
	template: scanTemplate
};

/** src[start..start+1] === '//' → index of the terminating newline (or EOF). */
const endOfLineComment = (src: string, start: number) => {
	const newline = src.indexOf('\n', start + 2);

	return newline < 0 ? src.length : newline;
};

/** src[start..start+1] === '/*' → index just past the closing delimiter (or EOF). */
const endOfBlockComment = (src: string, start: number) => {
	const close = src.indexOf('*/', start + 2);

	return close < 0 ? src.length : close + 2;
};

type MaskState = {
	/** src index up to which plain code has been copied to `parts`. */
	copiedUpTo: number;
	/** Has any literal/comment/regex token been consumed yet? */
	hasToken: boolean;
	/** Masked spans, in placeholder order. */
	pieces: string[];
	/** Output chunks (plain code slices and placeholders). */
	parts: string[];
	/** Current scan position. */
	pos: number;
	src: string;
	/** src index just past the most recent token. */
	tokenEnd: number;
};

/** Replace src[start, end) with a placeholder; copies the plain code before
 *  it first. */
const mask = (state: MaskState, start: number, end: number) => {
	state.parts.push(
		state.src.slice(state.copiedUpTo, start),
		`${SENTINEL}${state.pieces.length}${SENTINEL}`
	);
	state.pieces.push(state.src.slice(start, end));
	state.copiedUpTo = end;
};

/** A literal/comment/regex ends here; later chars are plain code. */
const noteToken = (state: MaskState, end: number) => {
	state.pos = end;
	state.tokenEnd = end;
	state.hasToken = true;
};

/** Would a `/` at `slash` start a regex literal? Looks back over the plain
 *  code since the previous token for the last significant char (whitespace
 *  skipped) and the identifier ending there. Reaching the previous token
 *  means a literal/regex/comment (never regex-ok) — unless there is none
 *  yet, i.e. only whitespace precedes the slash (regex-ok). */
const regexAllowedAt = (state: MaskState, slash: number) => {
	const { src, tokenEnd } = state;
	let pos = slash - 1;
	while (pos >= tokenEnd && isSpaceCode(src.charCodeAt(pos))) pos -= 1;
	if (pos < tokenEnd) return !state.hasToken;
	const prevCode = src.charCodeAt(pos);
	if (REGEX_OK_AFTER_CODE.has(prevCode)) return true;
	if (!isIdentCode(prevCode)) return false;
	let wordStart = pos;
	while (wordStart > tokenEnd && isIdentCode(src.charCodeAt(wordStart - 1)))
		wordStart -= 1;

	return REGEX_OK_AFTER_WORD.has(src.slice(wordStart, pos + 1));
};

const maskLineComment = (state: MaskState) => {
	const end = endOfLineComment(state.src, state.pos);
	mask(state, state.pos + 2, end);
	noteToken(state, end);
};

// The `/*` and `*/` delimiters stay in the masked text; only the body is a
// placeholder. An unterminated comment runs to EOF.
const maskBlockComment = (state: MaskState) => {
	const close = state.src.indexOf('*/', state.pos + 2);
	const bodyEnd = close < 0 ? state.src.length : close;
	mask(state, state.pos + 2, bodyEnd);
	noteToken(state, close < 0 ? state.src.length : close + 2);
};

const maskTemplate = (state: MaskState) => {
	const end = templateScanner.template(state.src, state.pos);
	mask(state, state.pos, end);
	noteToken(state, end);
};

// Only shield a string when its own text could be misread as a real import
// (contains `from`/`import`/`require` + quote) — e.g. an example-code snippet
// a page renders. A real import specifier string never matches, so it stays
// visible and gets rewritten.
const scanString = (state: MaskState) => {
	const end = endOfString(state.src, state.pos);
	if (RISKY_STRING_CONTENT.test(state.src.slice(state.pos, end)))
		mask(state, state.pos, end);
	noteToken(state, end);
};

/** A `/` that may start a regex: copy the literal verbatim, or treat the
 *  slash as division (plain code) when no regex ends on this line. */
const scanSlash = (state: MaskState) => {
	const end = regexAllowedAt(state, state.pos)
		? endOfRegex(state.src, state.pos)
		: -1;
	if (end > 0) noteToken(state, end);
	else state.pos += 1;
};

/** Index of the next char that can start a token, or `src.length`. */
const nextInteresting = (src: string, from: number) => {
	const len = src.length;
	let pos = from;
	while (pos < len) {
		const charCode = src.charCodeAt(pos);
		if (
			charCode === SLASH ||
			charCode === BACKTICK ||
			charCode === DOUBLE_QUOTE ||
			charCode === SINGLE_QUOTE
		)
			return pos;
		pos += 1;
	}

	return pos;
};

const scanToken = (state: MaskState) => {
	const charCode = state.src.charCodeAt(state.pos);
	const next = state.src.charCodeAt(state.pos + 1);
	if (charCode === SLASH && next === SLASH) maskLineComment(state);
	else if (charCode === SLASH && next === STAR) maskBlockComment(state);
	else if (charCode === BACKTICK) maskTemplate(state);
	else if (isQuoteCode(charCode)) scanString(state);
	else scanSlash(state);
};

export const maskLiterals = (src: string): MaskedSource => {
	const state: MaskState = {
		copiedUpTo: 0,
		hasToken: false,
		parts: [],
		pieces: [],
		pos: 0,
		src,
		tokenEnd: 0
	};
	const len = src.length;
	while (state.pos < len) {
		state.pos = nextInteresting(src, state.pos);
		if (state.pos < len) scanToken(state);
	}
	state.parts.push(src.slice(state.copiedUpTo));
	const { pieces } = state;

	const restoreRegex = new RegExp(`${SENTINEL}(\\d+)${SENTINEL}`, 'g');
	const restore = (rewritten: string) =>
		rewritten.replace(
			restoreRegex,
			(_placeholder, digits) => pieces[Number(digits)] ?? ''
		);

	return { masked: state.parts.join(''), restore };
};
