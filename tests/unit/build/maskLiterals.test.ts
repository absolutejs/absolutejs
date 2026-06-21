import { describe, expect, test } from 'bun:test';
import { maskLiterals } from '../../../src/build/maskLiterals';
import { rewriteImportsInContent } from '../../../src/build/rewriteImportsPlugin';

const BT = String.fromCharCode(96); // backtick, kept out of source template literals
const vendorPaths = {
	react: '/vendor/react.js',
	'drizzle-orm/neon-http': '/vendor/drizzle-neon.js'
};
const rw = (s: string) => rewriteImportsInContent(s, vendorPaths);

describe('import rewriter — real imports still rewrite', () => {
	test('static named import (double quotes)', () => {
		expect(rw('import { drizzle } from "drizzle-orm/neon-http";')).toBe(
			'import { drizzle } from "/vendor/drizzle-neon.js";'
		);
	});
	test('default import (single quotes)', () => {
		expect(rw("import React from 'react';")).toBe(
			"import React from '/vendor/react.js';"
		);
	});
	test('side-effect + dynamic import', () => {
		expect(rw('import "react";')).toBe('import "/vendor/react.js";');
		expect(rw('await import("react")')).toBe(
			'await import("/vendor/react.js")'
		);
	});
});

describe('import rewriter — does NOT touch non-code spans', () => {
	test('specifier inside a template-literal code sample is preserved', () => {
		const src =
			'export const code = ' +
			BT +
			"import { drizzle } from 'drizzle-orm/neon-http';\nconst x = 1;" +
			BT +
			';';
		expect(rw(src)).toBe(src);
	});

	test('specifier inside a // comment is preserved', () => {
		const src = "// import x from 'react';\nconst a = 1;";
		expect(rw(src)).toBe(src);
	});

	test('specifier inside a /* */ comment is preserved', () => {
		const src = "/* see: import x from 'react'; */\nconst a = 1;";
		expect(rw(src)).toBe(src);
	});

	test('mixed: real import rewritten, sample in same file preserved', () => {
		const real = 'import React from "react";\n';
		const sample =
			'const demo = ' + BT + "import X from 'react';" + BT + ';';
		expect(rw(real + sample)).toBe(
			'import React from "/vendor/react.js";\n' + sample
		);
	});

	test('template with ${} interpolation: sample preserved, code intact', () => {
		const src =
			'const c = ' +
			BT +
			"top ${1 + 1} import a from 'react' tail" +
			BT +
			';\nimport real from "react";';
		expect(rw(src)).toBe(
			'const c = ' +
				BT +
				"top ${1 + 1} import a from 'react' tail" +
				BT +
				';\nimport real from "/vendor/react.js";'
		);
	});

	test('specifier inside a plain (non-template) data string is preserved', () => {
		// Bun can lower a no-interpolation template literal to a plain string;
		// the snippet then lives in a "..." literal, which must still be shielded.
		const src = 'const sample = "import x from \'react\';\\nconst y = 1;";';
		expect(rw(src)).toBe(src);
	});

	test('real import specifiers next to data strings still rewrite', () => {
		const src =
			'const note = "uses react";\nimport React from "react";\n' +
			'export { z } from "react";';
		expect(rw(src)).toBe(
			'const note = "uses react";\nimport React from "/vendor/react.js";\n' +
				'export { z } from "/vendor/react.js";'
		);
	});

	test('regex literal containing quotes does not derail a later real import', () => {
		const src = 'const re = /[\'"]/g;\nimport x from "react";';
		expect(rw(src)).toBe('const re = /[\'"]/g;\nimport x from "/vendor/react.js";');
	});
});

describe('maskLiterals round-trip', () => {
	test('restore(masked) reproduces the source exactly', () => {
		const src =
			'import a from "react";\n' +
			'const code = ' +
			BT +
			"import b from 'react';" +
			BT +
			';\n' +
			"// import c from 'react'\n" +
			'const re = /a\\/b/;';
		const { masked, restore } = maskLiterals(src);
		expect(restore(masked)).toBe(src);
	});

	test('masked text has no leftover from/import inside the sample', () => {
		const src = 'const c = ' + BT + "import b from 'react';" + BT + ';';
		const { masked } = maskLiterals(src);
		expect(masked.includes("from 'react'")).toBe(false);
	});
});
