import { describe, expect, test } from 'bun:test';
import { Glob } from 'bun';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { maskLiterals, SENTINEL } from '../../../src/build/maskLiterals';

/* The token-skipping `maskLiterals` scanner must produce exactly the masked
 * text (and restore) of the character-by-character scanner it replaced. The
 * previous implementation is kept here verbatim as the reference and the two
 * are compared on real bundles, on the framework's own sources and on seeded
 * random input built from the characters the tokenizer cares about. */

// ---------------------------------------------------------------------------
// Reference: the previous character-by-character implementation (verbatim
// logic; only the export/annotations differ to satisfy the test lint rules).
// ---------------------------------------------------------------------------
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

const legacyMaskLiterals = (src: string) => {
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

	const endOfString = (start: number) => {
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
	// src index just past `${` → index just past the matching `}`.
	// Tracks the previous significant token (ipChar/ipWord) so a `/` inside the
	// interpolation is classified as a regex literal vs division. Without regex
	// handling, a regex that contains a quote — e.g. `${s.replace(/'/g, x)}` —
	// is misread as a string: `endOfString` runs past the interpolation, the
	// `{`/`}` depth desyncs, and the enclosing template is mis-masked to (nearly)
	// EOF, swallowing every real import after it (bare-specifier bug).
	const endOfInterp: (start: number) => number = (start) => {
		let j = start;
		let depth = 1;
		let ipChar = '';
		let ipWord = '';
		let ipSpace = false;
		while (j < n && depth > 0) {
			const c = src[j] as string; // j < n guarantees a char
			if (c === '\\') { j += 2; continue; }
			if (c === '`') {
				j = endOfTemplate(j);
				ipChar = ')'; ipWord = ''; ipSpace = false;
				continue;
			}
			if (c === '"' || c === "'") {
				j = endOfString(j);
				ipChar = '"'; ipWord = ''; ipSpace = false;
				continue;
			}
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
			if (
				c === '/' &&
				(ipChar === '' ||
					REGEX_OK_AFTER_CHAR.has(ipChar) ||
					REGEX_OK_AFTER_WORD.has(ipWord))
			) {
				const e = endOfRegex(j);
				if (e > 0) {
					j = e;
					ipChar = ')'; ipWord = ''; ipSpace = false;
					continue;
				}
			}
			if (c === '{') depth++;
			else if (c === '}') depth--;
			j++;
			if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
				ipSpace = true;
				continue;
			}
			if (isIdentChar(c)) {
				ipWord = isIdentChar(ipChar) && !ipSpace ? ipWord + c : c;
			} else {
				ipWord = '';
			}
			ipChar = c;
			ipSpace = false;
		}

		return j;
	};
	// src[start] === '`' → index just past the closing backtick
	const endOfTemplate: (start: number) => number = (start) => {
		let j = start + 1;
		while (j < n) {
			const c = src[j];
			if (c === '\\') { j += 2; continue; }
			if (c === '`') return j + 1;
			if (c === '$' && src[j + 1] === '{') { j = endOfInterp(j + 2); continue; }
			j++;
		}

		return j;
	};
	const endOfRegex = (start: number) => {
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

// ---------------------------------------------------------------------------

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..');

const expectSameMask = (source: string, label: string) => {
	const legacy = legacyMaskLiterals(source);
	const current = maskLiterals(source);
	if (legacy.masked !== current.masked) {
		throw new Error(
			`masked text differs for ${label}\n--- legacy\n${legacy.masked.slice(0, 400)}\n--- current\n${current.masked.slice(0, 400)}`
		);
	}
	// A placeholder-preserving edit must restore identically too.
	const edited = current.masked.replace(/react/g, 'REACT');
	expect(current.restore(edited)).toBe(legacy.restore(edited));
	// Round trip: only meaningful when the source can't itself contain a
	// placeholder-shaped sequence (the fuzz alphabet includes the sentinel).
	if (!source.includes(SENTINEL))
		expect(current.restore(current.masked)).toBe(source);
};

const listFiles = (pattern: string, cwd: string, limit: number) => {
	const files: string[] = [];
	for (const file of new Glob(pattern).scanSync({ absolute: true, cwd })) {
		files.push(file);
		if (files.length >= limit) break;
	}

	return files;
};

describe('maskLiterals — equivalent to the character-by-character scanner', () => {
	test('framework sources (src/**/*.ts)', () => {
		const files = listFiles('src/**/*.ts', PROJECT_ROOT, 2000);
		expect(files.length).toBeGreaterThan(100);
		for (const file of files) {
			expectSameMask(readFileSync(file, 'utf8'), file);
		}
	});

	test('framework tests and example app', () => {
		const files = [
			...listFiles('tests/**/*.ts', PROJECT_ROOT, 800),
			...listFiles('example/**/*.{ts,tsx,js,vue,svelte}', PROJECT_ROOT, 400)
		];
		expect(files.length).toBeGreaterThan(100);
		for (const file of files) {
			expectSameMask(readFileSync(file, 'utf8'), file);
		}
	});

	test('vendor bundles (react, react-dom, vue, svelte, rxjs, angular)', () => {
		const roots = [
			'react',
			'react-dom',
			'vue',
			'@vue',
			'svelte',
			'rxjs',
			'@angular/core',
			'@angular/common'
		];
		const files = roots.flatMap((root) =>
			listFiles(
				'**/*.{js,mjs,cjs}',
				resolve(PROJECT_ROOT, 'node_modules', root),
				150
			)
		);
		expect(files.length).toBeGreaterThan(200);
		let bytes = 0;
		for (const file of files) {
			const source = readFileSync(file, 'utf8');
			bytes += source.length;
			expectSameMask(source, file);
		}
		expect(bytes).toBeGreaterThan(5_000_000);
	});

	test('hand-picked edge cases', () => {
		const BT = String.fromCharCode(96);
		const cases = [
			'',
			'/',
			'//',
			'/*',
			'/* unterminated',
			'// unterminated',
			'"unterminated\nimport "react"',
			"'unterminated",
			BT,
			`${BT}\${`,
			`${BT}\${ ${BT}x${BT} }${BT}`,
			`${BT}\${s.replace(/'/g, "\\\\'")}${BT}; import z from "react";`,
			`${BT}\${ /* } */ 1 }${BT}`,
			`${BT}\${ // }\n 1 }${BT}`,
			`${BT}\${ a / b / c }${BT}`,
			`${BT}\${ return /x/ }${BT}`,
			'a = b / c / d;',
			'a = b\n/ c / d;',
			'x = /re/g.test(s) / 2;',
			'return /re/;',
			'typeof /re/',
			'x.return /re/',
			'"s" / 2',
			'"s"ab/c/',
			'/* c */ /re/',
			'// c\n/re/',
			`${BT}t${BT}/re/`,
			'\t/re/',
			'\\ /re/',
			'a = [/re/, /[/]/, /\\//];',
			'x = a\n/re/g',
			'/re/ /re/',
			'/[',
			'/[\n',
			'/\\',
			'"\\',
			"'\\",
			`${BT}\\`,
			'import x from "react"; /from "react"/.test(y)',
			'const s = "from \'react\'"; const t = \'import "x"\'',
			'x = y /* import "react" */ / 2 / z',
			'else/re/',
			'in/re/',
			'a in/re/',
			'xin/re/',
			'x\u00a0/re/',
			'x\v/re/',
			'\r\n/re/'
		];
		for (const source of cases) expectSameMask(source, JSON.stringify(source));
	});

	test('seeded fuzz over tokenizer-relevant characters', () => {
		// mulberry32 — deterministic across runs.
		let seed = 0x9e3779b9;
		const random = () => {
			seed = (seed + 0x6d2b79f5) | 0;
			let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
		const alphabet = [
			'/', '/', '/', '"', "'", String.fromCharCode(96), '\\', '$', '{', '}',
			'*', '\n', '\n', ' ', ' ', '\t', '\r', '[', ']', '(', ')', '=', ',',
			';', ':', '!', '+', '-', 'a', 'b', 'x', 'g', 'i', '_', '0', '9',
			'return', 'typeof', 'in', 'of', 'new', 'else', 'from "react"',
			'import "x"', 'require(', 'import(', '${', '*/', '//', '/*', SENTINEL
		];
		for (let round = 0; round < 6000; round += 1) {
			const length = Math.floor(random() * 40);
			let source = '';
			for (let index = 0; index < length; index += 1) {
				source += alphabet[Math.floor(random() * alphabet.length)];
			}
			expectSameMask(source, JSON.stringify(source));
		}
	});
});
