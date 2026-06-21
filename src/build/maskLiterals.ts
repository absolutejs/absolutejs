/** Shields non-code spans from the regex/text-based import rewriters.
 *
 *  The import rewriters (rewriteReactImports, rewriteImportsPlugin, and the
 *  native Zig scanner) replace `from "X"` / `import "X"` / `import("X")` across
 *  the whole file text. That text scan can't tell a real import from the *text*
 *  `from 'X'` sitting inside a TEMPLATE LITERAL (an example-code snippet a page
 *  renders) or a comment — so it rewrites the snippet's specifier too. The
 *  server pre-render keeps the snippet verbatim while the browser bundle gets it
 *  rewritten, so the two diverge → React hydration mismatch on the code block.
 *
 *  Fix: before rewriting, replace template literals and comment bodies with
 *  opaque placeholders; rewrite; then restore them verbatim. Regular string
 *  literals (where real import specifiers live) and regex literals pass through
 *  untouched, so real import rewriting is completely unaffected.
 *
 *  Usage: `const { masked, restore } = maskLiterals(src)`, run the existing
 *  rewriter on `masked`, then `restore(rewritten)`.
 */

// Private-Use-Area sentinel: never appears in real JS/TS source, carries no
// from/import/quote chars, so placeholders can't collide with code or be
// matched by the rewriters.
const SENTINEL = '';

const isIdentChar = (c: string) => /[A-Za-z0-9_$]/.test(c);

// A `/` starts a regex literal (not division) when the previous significant
// token is one of these chars, or one of the keywords below, or nothing (BOF).
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
	let prevChar = ''; // last significant (non-whitespace) code char
	let prevWord = ''; // trailing identifier run in code

	const mask = (text: string) => {
		out += SENTINEL + pieces.length + SENTINEL;
		pieces.push(text);
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
	function endOfString(start: number): number {
		const q = src[start];
		let j = start + 1;
		while (j < n) {
			const c = src[j];
			if (c === '\\') { j += 2; continue; }
			if (c === q) return j + 1;
			if (c === '\n') return j;
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
			prevChar = '';
			prevWord = '';
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
			prevChar = '`';
			prevWord = '';
			continue;
		}
		if (c === '"' || c === "'") {
			const end = endOfString(i);
			out += src.slice(i, end);
			i = end;
			prevChar = '"';
			prevWord = '';
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
				prevChar = '/';
				prevWord = '';
				continue;
			}
		}

		out += c;
		i++;
		if (c === ' ' || c === '\t' || c === '\r' || c === '\n') continue;
		const wasIdent = isIdentChar(prevChar);
		prevChar = c;
		prevWord = isIdentChar(c) ? (wasIdent ? prevWord + c : c) : '';
	}

	const restoreRegex = new RegExp(`${SENTINEL}(\\d+)${SENTINEL}`, 'g');
	const restore = (rewritten: string) =>
		rewritten.replace(restoreRegex, (_m, d) => pieces[Number(d)] ?? '');

	return { masked: out, restore };
};
