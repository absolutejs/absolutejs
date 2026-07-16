/** Shields non-code spans from the regex/text-based import rewriters.
 *
 *  The import rewriters (rewriteReactImports, rewriteImportsPlugin, the native
 *  Zig scanner, and compile's runtime-specifier rewrite) replace `from "X"` /
 *  `import "X"` / `import("X")` / `require("X")` across the whole file text. That
 *  text scan can't tell a real import from the *text* `from 'X'` sitting inside a
 *  template literal / data string (an example-code snippet a page renders) or a
 *  comment — so it rewrites the snippet's specifier too. The browser bundle then
 *  diverges from the SSR pre-render → React hydration mismatch on the code block.
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
 */

// Private-Use-Area sentinel: never appears in real source, carries no
// from/import/quote chars, so placeholders can't collide with code or be matched
// by the rewriters.
export const SENTINEL = String.fromCharCode(0xe000);

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

const isIdentChar = (c: string) => /[A-Za-z0-9_$]/.test(c);

// A `/` starts a regex literal (not division) when the previous significant
// token is one of these chars/keywords, or nothing (start of file).
const REGEX_OK_AFTER_CHAR = new Set([
	'(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';',
	'+', '-', '*', '/', '%', '^', '~', '<', '>'
]);
const REGEX_OK_AFTER_WORD = new Set([
	'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
	'do', 'else', 'yield', 'await', 'case'
]);

export type MaskedSource = {
	masked: string;
	restore: (rewritten: string) => string;
};

export const maskLiterals = (src: string): MaskedSource => {
	const n = src.length;
	const pieces: string[] = [];
	let out = '';
	let i = 0;

	// State used by the regex-vs-division heuristic.
	let prevChar = ''; // last significant (non-whitespace) code char
	let prevWord = ''; // identifier immediately preceding (through whitespace)
	let prevWasSpace = false; // was the immediately previous char whitespace?

	const mask = (text: string) => {
		out += SENTINEL + pieces.length + SENTINEL;
		pieces.push(text);
		prevChar = ')'; // a literal stands where a value would; not a word
		prevWord = '';
		prevWasSpace = false;
	};

	const endOfString = (start: number): number => {
		const q = src[start];
		let j = start + 1;
		while (j < n) {
			const c = src[j];
			if (c === '\\') { j += 2; continue; }
			if (c === q) return j + 1;
			if (c === '\n') return j; // unterminated guard
			j++;
		}

		return j;
	};
	// src index just past `${` → index just past the matching `}`
	const endOfInterp = (start: number): number => {
		let j = start;
		let depth = 1;
		while (j < n && depth > 0) {
			const c = src[j];
			if (c === '\\') { j += 2; continue; }
			if (c === '`') { j = endOfTemplate(j); continue; }
			if (c === '"' || c === "'") { j = endOfString(j); continue; }
			if (c === '/' && src[j + 1] === '/') {
				const nl = src.indexOf('\n', j);
				j = nl < 0 ? n : nl;
				continue;
			}
			if (c === '/' && src[j + 1] === '*') {
				const e = src.indexOf('*/', j + 2);
				j = e < 0 ? n : e + 2;
				continue;
			}
			if (c === '{') depth++;
			else if (c === '}') depth--;
			j++;
		}

		return j;
	};
	// src[start] === '`' → index just past the closing backtick
	function endOfTemplate(start: number): number {
		let j = start + 1;
		while (j < n) {
			const c = src[j];
			if (c === '\\') { j += 2; continue; }
			if (c === '`') return j + 1;
			if (c === '$' && src[j + 1] === '{') { j = endOfInterp(j + 2); continue; }
			j++;
		}

		return j;
	}
	const endOfRegex = (start: number): number => {
		let j = start + 1;
		let inClass = false;
		while (j < n) {
			const c = src[j];
			if (c === '\\') { j += 2; continue; }
			if (c === '\n') return -1; // unterminated → treat the slash as division
			if (c === '[') inClass = true;
			else if (c === ']') inClass = false;
			else if (c === '/' && !inClass) { j++; break; }
			j++;
		}
		while (j < n && /[a-z]/i.test(src[j] ?? '')) j++; // flags

		return j;
	};

	while (i < n) {
		const c = src[i] as string; // i < n guarantees a char
		const c2 = src[i + 1];

		if (c === '/' && c2 === '/') {
			out += '//';
			i += 2;
			const s = i;
			while (i < n && src[i] !== '\n') i++;
			mask(src.slice(s, i));
			continue;
		}
		if (c === '/' && c2 === '*') {
			out += '/*';
			i += 2;
			const e = src.indexOf('*/', i);
			const end = e < 0 ? n : e;
			mask(src.slice(i, end));
			i = end < n ? end + 2 : n;
			if (end < n) out += '*/';
			continue;
		}
		if (c === '`') {
			const end = endOfTemplate(i);
			mask(src.slice(i, end));
			i = end;
			continue;
		}
		if (c === '"' || c === "'") {
			const end = endOfString(i);
			const text = src.slice(i, end);
			// Only shield a string when its own text could be misread as a real
			// import (contains `from`/`import`/`require` + quote) — e.g. an
			// example-code snippet a page renders. A real import specifier
			// string never matches, so it stays visible and gets rewritten.
			if (RISKY_STRING_CONTENT.test(text)) {
				mask(text);
			} else {
				out += text;
				prevChar = '"';
				prevWord = '';
				prevWasSpace = false;
			}
			i = end;
			continue;
		}
		if (
			c === '/' &&
			(prevChar === '' ||
				REGEX_OK_AFTER_CHAR.has(prevChar) ||
				REGEX_OK_AFTER_WORD.has(prevWord))
		) {
			const end = endOfRegex(i);
			if (end > 0) {
				out += src.slice(i, end);
				i = end;
				prevChar = ')';
				prevWord = '';
				prevWasSpace = false;
				continue;
			}
		}

		out += c;
		i++;
		if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
			prevWasSpace = true;
			continue;
		}
		if (isIdentChar(c)) {
			const contiguous = isIdentChar(prevChar) && !prevWasSpace;
			prevWord = contiguous ? prevWord + c : c;
		} else {
			prevWord = '';
		}
		prevChar = c;
		prevWasSpace = false;
	}

	const restoreRegex = new RegExp(`${SENTINEL}(\\d+)${SENTINEL}`, 'g');
	const restore = (rewritten: string) =>
		rewritten.replace(restoreRegex, (_m, d) => pieces[Number(d)] ?? '');

	return { masked: out, restore };
};
