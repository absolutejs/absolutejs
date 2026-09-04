/* Source transform used by the import-cost recorder.
 *
 * Every module the dev child loads is bracketed with an enter call at the top
 * of its body and an exit call at the very end. In ESM that pair measures a
 * module's *own* evaluation, exclusive of its static children, for free: a
 * module's body does not start until every module it statically imports has
 * finished evaluating. CommonJS nests instead (its `require()` calls run
 * inline), which the replay in `selfTimes.ts` handles with a stack.
 *
 * Two properties matter and are covered by unit tests:
 *
 * - line numbers are preserved. The enter call is inserted without a newline
 *   and the exit call is appended after one, so stack traces and the dev
 *   sourcemap chain keep pointing at the right lines.
 * - the enter call goes *after* the directive prologue, so `"use strict"`,
 *   `"use client"` and a `#!` shebang keep their meaning.
 *
 * The calls are optional (`?.()`): if this transform ever reaches a bundler
 * rather than the runtime, the emitted bundle is a no-op instead of a
 * `ReferenceError`. */

const BYTE_ORDER_MARK = 0xfe_ff;
const NOT_FOUND = -1;

/** Whitespace, comments, and directive-prologue string literals — the things
 *  that may legally precede the first real statement of a module. */
const PROLOGUE_TOKEN =
	/\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|(['"])use [^'"\n]*\1[ \t]*;?/y;

const prologueEnd = (source: string) => {
	let index = source.charCodeAt(0) === BYTE_ORDER_MARK ? 1 : 0;
	if (source.startsWith('#!', index)) {
		const newline = source.indexOf('\n', index);
		index = newline === NOT_FOUND ? source.length : newline + 1;
	}
	for (;;) {
		PROLOGUE_TOKEN.lastIndex = index;
		if (PROLOGUE_TOKEN.exec(source) === null) return index;
		index = PROLOGUE_TOKEN.lastIndex;
	}
};

export type ImportCostLoader = 'js' | 'jsx' | 'ts' | 'tsx';

const TYPESCRIPT_EXTENSION = /\.[cm]?ts$/;
const JS_LOADER: ImportCostLoader = 'js';
const JSX_LOADER: ImportCostLoader = 'jsx';
const TS_LOADER: ImportCostLoader = 'ts';
const TSX_LOADER: ImportCostLoader = 'tsx';

/** The Bun loader to hand back with the rewritten contents. Bun infers
 *  CommonJS versus ESM from the source, so `.cjs`/`.mjs` both take `js`. */
export const importCostLoader = (path: string) => {
	if (path.endsWith('.tsx')) return TSX_LOADER;
	if (path.endsWith('.jsx')) return JSX_LOADER;
	if (TYPESCRIPT_EXTENSION.test(path)) return TS_LOADER;

	return JS_LOADER;
};

export const instrumentModuleSource = (source: string, moduleIndex: number) => {
	const insertAt = prologueEnd(source);
	const enter = `globalThis.__absoluteImportCostEnter?.(${moduleIndex});`;
	const exit = `\n;globalThis.__absoluteImportCostExit?.(${moduleIndex});`;

	return `${source.slice(0, insertAt)}${enter}${source.slice(insertAt)}${exit}`;
};
