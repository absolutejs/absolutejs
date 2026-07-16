import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { maskLiterals } from '../../../src/build/maskLiterals';
import { rewriteReactImports } from '../../../src/build/rewriteReactImports';

// backtick, kept out of source template literals so this file stays readable
const BT = String.fromCharCode(96);

const vendorPaths = {
	react: '/react/vendor/react.js',
	'react-dom': '/react/vendor/react-dom.js',
	'react/jsx-dev-runtime': '/react/vendor/react_jsx-dev-runtime.js',
	'react/jsx-runtime': '/react/vendor/react_jsx-runtime.js'
};

let dir: string;
let counter = 0;

// Run one chunk's text through the real (file-based) rewriter and return the
// rewritten text.
const rewrite = async (source: string) => {
	const file = join(dir, `chunk-${counter++}.js`);
	await Bun.write(file, source);
	await rewriteReactImports([file], vendorPaths);

	return Bun.file(file).text();
};

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), 'absolute-rewrite-react-'));
});
afterAll(() => {
	rmSync(dir, { force: true, recursive: true });
});

// Regression: @absolutejs/absolute 0.19.0-beta.1099 left a bare
// `react/jsx-runtime` / `react/jsx-dev-runtime` specifier in one bundled chunk,
// breaking hydration ("Failed to resolve module specifier"). Root cause: the
// maskLiterals pass (added after beta.1076) masked real import specifier
// strings whenever the `isSpecifier` heuristic misfired, so the rewriter never
// saw them. Every real vendor import must now be rewritten regardless of what
// precedes the specifier.
describe('rewriteReactImports — every real jsx-runtime import is vendored', () => {
	test('minified named import (prod jsx)', async () => {
		expect(await rewrite('import{jsx as a}from"react/jsx-runtime";')).toBe(
			'import{jsx as a}from"/react/vendor/react_jsx-runtime.js";'
		);
	});

	test('dev jsxDEV import', async () => {
		expect(
			await rewrite('import{jsxDEV}from"react/jsx-dev-runtime";')
		).toBe('import{jsxDEV}from"/react/vendor/react_jsx-dev-runtime.js";');
	});

	test('shared-chunk import preceded by a source-path banner comment', async () => {
		const out = await rewrite(
			'// app/comp/ui.tsx\nimport { jsxDEV } from "react/jsx-dev-runtime";\nvar x = 1;\n'
		);
		expect(out).toContain(
			'from "/react/vendor/react_jsx-dev-runtime.js"'
		);
		expect(out).not.toContain('"react/jsx-dev-runtime"');
	});

	test('side-effect and re-export forms', async () => {
		expect(await rewrite('import"react/jsx-runtime";')).toBe(
			'import"/react/vendor/react_jsx-runtime.js";'
		);
		expect(
			await rewrite('export{Fragment}from"react/jsx-runtime";')
		).toBe('export{Fragment}from"/react/vendor/react_jsx-runtime.js";');
	});

	// The safety-net sweep: a real import whose specifier is separated from its
	// `from` keyword by a comment (so it is NOT `from"..."`-adjacent in the
	// masked text) must still be rewritten.
	test('specifier separated from `from` by a block comment', async () => {
		const out = await rewrite(
			'import{jsx}from/* keep */"react/jsx-runtime";'
		);
		expect(out).toContain('"/react/vendor/react_jsx-runtime.js"');
		expect(out).not.toContain('"react/jsx-runtime"');
	});
});

describe('rewriteReactImports — never rewrites specifier TEXT (no false positives)', () => {
	test("React's dev error-message template is left untouched", async () => {
		const src =
			'function warn() {\n  throw Error(' +
			BT +
			'A library pre-bundled an old copy of "react" or "react/jsx-runtime".' +
			BT +
			');\n}\n';
		expect(await rewrite(src)).toBe(src);
	});

	test('import-like text inside a rendered code sample (template) is preserved', async () => {
		const src =
			'export const sample = ' +
			BT +
			'import { jsx } from "react/jsx-runtime";' +
			BT +
			';\n';
		expect(await rewrite(src)).toBe(src);
	});

	test('import-like text inside a plain string is preserved', async () => {
		// Double-quoted string whose inner import uses single quotes: the
		// rewriter's `from\\s*['\"]` WOULD match `from 'react'` here, so this
		// only stays intact because maskLiterals shields it.
		const src = 'export const doc = "import App from \'react\'";\n';
		expect(await rewrite(src)).toBe(src);
	});

	test('a bare specifier used as a data value (not an import) is preserved', async () => {
		const src = 'export const name = "react/jsx-runtime";\n';
		expect(await rewrite(src)).toBe(src);
	});
});

// Unit-level guard for the Option-1 half of the fix: a genuine specifier string
// must stay VISIBLE (unmasked) so the rewriter can see it, while an example-code
// string that contains import-like text is masked away.
describe('maskLiterals — content-gated string masking', () => {
	test('a bare specifier string is not masked', () => {
		const { masked } = maskLiterals('import{jsx}from"react/jsx-runtime";');
		expect(masked).toContain('"react/jsx-runtime"');
	});

	test('a string whose text could be misread as an import IS masked', () => {
		const { masked } = maskLiterals(
			"const s = \"import App from 'react'\";"
		);
		expect(masked).not.toContain('import App from');
	});
});
