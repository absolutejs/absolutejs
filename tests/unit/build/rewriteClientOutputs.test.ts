import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { maskLiterals, SENTINEL } from '../../../src/build/maskLiterals';
import {
	describeNativeRewriteFallback,
	nativeRewriteImports
} from '../../../src/build/nativeRewrite';
import {
	compileClientRewriteFamilies,
	reduceVendorPaths,
	rewriteClientContent,
	rewriteClientOutputs,
	rewriteUrlReferencesInContent
} from '../../../src/build/rewriteClientOutputs';
import { jsRewriteImports } from '../../../src/build/rewriteImportsPlugin';
import { REFRESH_STUBS } from '../../../src/build/rewriteReactImports';
import {
	compileSpecifierRewriter,
	hasSpecifierCandidate,
	rewriteSpecifiers
} from '../../../src/build/specifierRewriter';

// backtick, kept out of source template literals so this file stays readable
const BT = String.fromCharCode(96);

const reactPaths = {
	react: '/react/vendor/react.js',
	'react-dom': '/react/vendor/react-dom.js',
	'react-dom/client': '/react/vendor/react-dom_client.js',
	'react/jsx-runtime': '/react/vendor/react_jsx-runtime.js'
};
const vendorPaths = {
	'@angular/core': '/angular/vendor/angular_core.js',
	vue: '/vue/vendor/vue.js'
};
const urlFileMap = new Map([['worker.ts', '/@src/example/worker.ts?v=1']]);

// One chunk exercising every family plus the constructs maskLiterals exists
// for: import-like text inside a template, a string, a regex literal and
// comments (none of which may be rewritten), a comment between `from` and
// the specifier, a dynamic import, a `require`, and a refresh-global call.
const fixture = [
	'// example/react/pages/Home.tsx',
	'import { jsx } from "react/jsx-runtime";',
	"import React from 'react';",
	'import "react-dom";',
	'import { ref } from "vue";',
	'import { Component } from "@angular/core";',
	'import client from/* keep */"react-dom/client";',
	'const lazy = () => import("react-dom");',
	"const dyn = import('vue');",
	"const req = require ( 'vue' );",
	`const snippet = ${BT}import { useState } from "react";\\nconst a = 1;${BT};`,
	`const str = 'import React from "react"';`,
	'const re = /from "react"/g;',
	"const url = new URL('./worker.ts', import.meta.url);",
	'const other = new URL("./missing.ts", import.meta.url);',
	'const div = a / b / c; // from "react" in a comment',
	'/* import "vue" */',
	'function Comp() { $RefreshReg$(Comp, "Comp"); }',
	'export default Comp;',
	''
].join('\n');

// What the four standalone passes produced for `fixture` — preserved exactly,
// including the one pre-existing quirk: `maskLiterals` copies regex literals
// verbatim (it only masks strings/templates/comments), so import-like text
// inside a regex body is visible to the rewriters and gets rewritten.
const expectedImports = [
	'// example/react/pages/Home.tsx',
	'import { jsx } from "/react/vendor/react_jsx-runtime.js";',
	"import React from '/react/vendor/react.js';",
	'import "/react/vendor/react-dom.js";',
	'import { ref } from "/vue/vendor/vue.js";',
	'import { Component } from "/angular/vendor/angular_core.js";',
	'import client from/* keep */"/react/vendor/react-dom_client.js";',
	'const lazy = () => import("/react/vendor/react-dom.js");',
	"const dyn = import('/vue/vendor/vue.js');",
	// `require` is only caught by the react family's sweep; the vendor family
	// never had one, so a vendor `require` stays bare — exactly as before.
	"const req = require ( 'vue' );",
	`const snippet = ${BT}import { useState } from "react";\\nconst a = 1;${BT};`,
	`const str = 'import React from "react"';`,
	'const re = /from "/react/vendor/react.js"/g;',
	"const url = new URL('./worker.ts', import.meta.url);",
	'const other = new URL("./missing.ts", import.meta.url);',
	'const div = a / b / c; // from "react" in a comment',
	'/* import "vue" */',
	'function Comp() { $RefreshReg$(Comp, "Comp"); }',
	'export default Comp;',
	''
].join('\n');

const expectedAll =
	REFRESH_STUBS +
	expectedImports.replace(
		"new URL('./worker.ts', import.meta.url)",
		"new URL('/@src/example/worker.ts?v=1', import.meta.url)"
	);

// ---------------------------------------------------------------------------
// Legacy implementations (verbatim logic of the four standalone passes before
// they were folded into one), used as the reference for equivalence.
// ---------------------------------------------------------------------------
const escapeRegex = (str: string) =>
	str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const sortedReplacements = (paths: Record<string, string>) =>
	Object.entries(paths).sort(([keyA], [keyB]) => keyB.length - keyA.length);

// rewriteReactImports' JS fallback: three regexes over the whole content.
const legacyReactMain = (content: string, paths: Record<string, string>) => {
	const replacements = sortedReplacements(paths);
	const lookup = new Map(replacements);
	const alt = replacements.map(([spec]) => escapeRegex(spec)).join('|');
	const replacer = (
		match: string,
		prefix: string,
		specifier: string,
		suffix: string
	) => {
		const webPath = lookup.get(specifier);

		return webPath ? `${prefix}${webPath}${suffix}` : match;
	};
	let result = content;
	result = result.replace(
		new RegExp(`(from\\s*["'])(${alt})(["'])`, 'g'),
		replacer
	);
	result = result.replace(
		new RegExp(`(import\\s*["'])(${alt})(["']\\s*;?)`, 'g'),
		replacer
	);
	result = result.replace(
		new RegExp(`(import\\s*\\(\\s*["'])(${alt})(["']\\s*\\))`, 'g'),
		replacer
	);

	return result;
};

// rewriteReactImports' safety-net sweep: three more regexes.
const legacyReactSweep = (content: string, paths: Record<string, string>) => {
	const replacements = sortedReplacements(paths);
	const lookup = new Map(replacements);
	const alt = replacements.map(([spec]) => escapeRegex(spec)).join('|');
	const ph = `${SENTINEL}\\d+${SENTINEL}`;
	const gap = `(?:\\s|${ph}|/\\*${ph}\\*/|//${ph})*`;
	const replacer = (
		match: string,
		prefix: string,
		specifier: string,
		suffix: string
	) => {
		const webPath = lookup.get(specifier);

		return webPath ? `${prefix}${webPath}${suffix}` : match;
	};
	let result = content;
	result = result.replace(
		new RegExp(`(\\bfrom${gap}["'])(${alt})(["'])`, 'g'),
		replacer
	);
	result = result.replace(
		new RegExp(`(\\bimport${gap}["'])(${alt})(["'])`, 'g'),
		replacer
	);
	result = result.replace(
		new RegExp(`(\\b(?:import|require)${gap}\\(${gap}["'])(${alt})(["'])`, 'g'),
		replacer
	);

	return result;
};

// rewriteImportsPlugin's old JS fallback: three fresh regexes PER specifier.
const legacyVendorMain = (content: string, paths: Record<string, string>) => {
	let result = content;
	for (const [specifier, webPath] of sortedReplacements(paths)) {
		const escaped = escapeRegex(specifier);
		result = result.replace(
			new RegExp(`(from\\s*["'])${escaped}(["'])`, 'g'),
			`$1${webPath}$2`
		);
		result = result.replace(
			new RegExp(`(import\\s*["'])${escaped}(["'])`, 'g'),
			`$1${webPath}$2`
		);
		result = result.replace(
			new RegExp(`(import\\s*\\(\\s*["'])${escaped}(["']\\s*\\))`, 'g'),
			`$1${webPath}$2`
		);
	}

	return result;
};

const legacyRefresh = (content: string) =>
	(content.includes('$RefreshReg$(') || content.includes('$RefreshSig$(')) &&
	!content.startsWith('window.$RefreshReg$')
		? REFRESH_STUBS + content
		: content;

const legacyUrl = (content: string, map: Map<string, string>) =>
	content.replace(
		/new\s+URL\(\s*["'](\.\.?\/[^"']+)["']\s*,\s*import\.meta\.url\s*\)/g,
		(match, relPath: string) => {
			const resolved = map.get(relPath.split('/').pop() ?? '');

			return resolved
				? `new URL('${resolved}', import.meta.url)`
				: match;
		}
	);

type LegacyOptions = {
	native: boolean;
	react?: Record<string, string>;
	refresh?: boolean;
	url?: Map<string, string>;
	vendor?: Record<string, string>;
};

/** The old pipeline: four passes, each masking and restoring on its own. */
const legacyPipeline = (original: string, options: LegacyOptions) => {
	let content = original;
	if (options.react) {
		const { masked, restore } = maskLiterals(content);
		const native = options.native
			? nativeRewriteImports(masked, sortedReplacements(options.react))
			: null;
		const main = native ?? legacyReactMain(masked, options.react);
		content = restore(legacyReactSweep(main, options.react));
	}
	if (options.refresh) content = legacyRefresh(content);
	if (options.vendor) {
		const { masked, restore } = maskLiterals(content);
		const native = options.native
			? nativeRewriteImports(masked, sortedReplacements(options.vendor))
			: null;
		content = restore(native ?? legacyVendorMain(masked, options.vendor));
	}
	if (options.url) content = legacyUrl(content, options.url);

	return content;
};

const nativeAvailable = describeNativeRewriteFallback() === null;

let dir: string;
let counter = 0;
const writeChunk = async (source: string) => {
	const file = join(dir, `chunk-${counter++}.js`);
	await Bun.write(file, source);

	return file;
};

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), 'absolute-client-rewrite-'));
});
afterAll(() => {
	rmSync(dir, { force: true, recursive: true });
});

describe('rewriteClientContent — each family in isolation', () => {
	test('react family: real imports vendored, masked text untouched', () => {
		const families = compileClientRewriteFamilies({ reactPaths });
		const out = rewriteClientContent(fixture, families, true);
		expect(out).toBe(
			legacyPipeline(fixture, { native: nativeAvailable, react: reactPaths })
		);
		expect(out).toContain('from "/react/vendor/react_jsx-runtime.js"');
		expect(out).toContain('from/* keep */"/react/vendor/react-dom_client.js"');
		expect(out).toContain('import("/react/vendor/react-dom.js")');
		expect(out).toContain(`import { useState } from "react";`);
		expect(out).toContain(`'import React from "react"'`);
		expect(out).toContain('/from "/react/vendor/react.js"/g');
		expect(out).toContain('// from "react" in a comment');
		expect(out).toContain('from "vue"');
		expect(out).not.toStartWith('window.$RefreshReg$');
	});

	test('vendor family: no sweep, so a spaced `require` stays bare', () => {
		const families = compileClientRewriteFamilies({ vendorPaths });
		const out = rewriteClientContent(fixture, families, true);
		expect(out).toBe(
			legacyPipeline(fixture, {
				native: nativeAvailable,
				vendor: vendorPaths
			})
		);
		expect(out).toContain('from "/vue/vendor/vue.js"');
		expect(out).toContain('from "/angular/vendor/angular_core.js"');
		expect(out).toContain("import('/vue/vendor/vue.js')");
		expect(out).toContain("require ( 'vue' )");
		expect(out).toContain('/* import "vue" */');
		expect(out).toContain("from 'react'");
	});

	test('refresh globals: stubs prepended exactly once', () => {
		const families = compileClientRewriteFamilies({ refreshGlobals: true });
		const out = rewriteClientContent(fixture, families, true);
		expect(out).toBe(REFRESH_STUBS + fixture);
		expect(rewriteClientContent(out, families, true)).toBe(out);
		expect(
			rewriteClientContent('const a = 1;\n', families, true)
		).toBe('const a = 1;\n');
	});

	test('url references: mapped targets rewritten, unmapped left alone', () => {
		const families = compileClientRewriteFamilies({ urlFileMap });
		const out = rewriteClientContent(fixture, families, true);
		expect(out).toBe(legacyPipeline(fixture, { native: false, url: urlFileMap }));
		expect(out).toContain(
			"new URL('/@src/example/worker.ts?v=1', import.meta.url)"
		);
		expect(out).toContain('new URL("./missing.ts", import.meta.url)');
	});

	test('non-JS outputs only get the url family', () => {
		const families = compileClientRewriteFamilies({
			reactPaths,
			refreshGlobals: true,
			urlFileMap,
			vendorPaths
		});
		const css = `/* import "react" */ .a { b: url("./worker.ts") }\n`;
		expect(rewriteClientContent(css, families, false)).toBe(css);
		const map = `{"x":"new URL('./worker.ts', import.meta.url)"}`;
		expect(rewriteClientContent(map, families, false)).toBe(
			`{"x":"new URL('/@src/example/worker.ts?v=1', import.meta.url)"}`
		);
	});
});

describe('rewriteClientContent — all families together', () => {
	const families = compileClientRewriteFamilies({
		reactPaths,
		refreshGlobals: true,
		urlFileMap,
		vendorPaths
	});

	test('matches the expected output', () => {
		expect(rewriteClientContent(fixture, families, true)).toBe(expectedAll);
	});

	test('matches the legacy four-pass pipeline (native and JS fallback)', () => {
		const legacyOptions = {
			react: reactPaths,
			refresh: true,
			url: urlFileMap,
			vendor: vendorPaths
		};
		expect(rewriteClientContent(fixture, families, true)).toBe(
			legacyPipeline(fixture, { ...legacyOptions, native: nativeAvailable })
		);
		const jsFamilies = compileClientRewriteFamilies({
			native: false,
			reactPaths,
			refreshGlobals: true,
			urlFileMap,
			vendorPaths
		});
		expect(rewriteClientContent(fixture, jsFamilies, true)).toBe(
			legacyPipeline(fixture, { ...legacyOptions, native: false })
		);
	});

	test('is idempotent', () => {
		const once = rewriteClientContent(fixture, families, true);
		expect(rewriteClientContent(once, families, true)).toBe(once);
	});
});

describe('precheck skip', () => {
	test('returns the same string instance when no family can match', () => {
		const families = compileClientRewriteFamilies({
			reactPaths,
			refreshGlobals: true,
			urlFileMap,
			vendorPaths
		});
		const plain = 'const react = "no import here"; url("x");\n';
		expect(rewriteClientContent(plain, families, true)).toBe(plain);
		expect(
			hasSpecifierCandidate(plain, compileSpecifierRewriter(reactPaths))
		).toBe(false);
	});

	test('a candidate substring is required, not sufficient', () => {
		const rewriter = compileSpecifierRewriter(reactPaths);
		expect(hasSpecifierCandidate('x = "react-native"', rewriter)).toBe(true);
		expect(hasSpecifierCandidate("from 'react'", rewriter)).toBe(true);
		expect(hasSpecifierCandidate('/react/vendor/react.js', rewriter)).toBe(
			false
		);
	});

	test('rewriteClientOutputs neither rewrites nor touches a skipped file', async () => {
		const untouched = await writeChunk('export const a = 1;\n');
		const touched = await writeChunk('import "react";\n');
		const before = statSync(untouched).mtimeMs;
		await Bun.sleep(20);
		const stats = await rewriteClientOutputs([untouched, touched], {
			reactPaths,
			refreshGlobals: true,
			urlFileMap,
			vendorPaths
		});
		expect(stats).toEqual({ files: 2, rewritten: 1 });
		expect(statSync(untouched).mtimeMs).toBe(before);
		expect(await Bun.file(touched).text()).toBe(
			'import "/react/vendor/react.js";\n'
		);
	});
});

describe('reduceVendorPaths', () => {
	test('drops entries the react family already maps identically', () => {
		expect(
			reduceVendorPaths(
				{ ...vendorPaths, react: reactPaths.react, vue: '/other/vue.js' },
				{ ...reactPaths, '@angular/core': vendorPaths['@angular/core'] }
			)
		).toEqual({ vue: '/other/vue.js' });
	});

	test('a covered vendor family is a no-op after the react family', () => {
		const combined = { ...reactPaths, ...vendorPaths };
		const withVendor = compileClientRewriteFamilies({
			reactPaths: combined,
			vendorPaths
		});
		expect(withVendor.vendor).toBeUndefined();
		const reactOnly = compileClientRewriteFamilies({ reactPaths: combined });
		const out = rewriteClientContent(fixture, reactOnly, true);
		expect(rewriteClientContent(fixture, withVendor, true)).toBe(out);
		// ...and equals the old react-then-vendor pipeline on the same maps.
		expect(out).toBe(
			legacyPipeline(fixture, {
				native: nativeAvailable,
				react: combined,
				vendor: vendorPaths
			})
		);
	});
});

describe('rewriteSpecifiers — JS fallback equals the per-specifier passes', () => {
	const cases = [
		fixture,
		'import{jsx as a}from"react/jsx-runtime";import"react-dom";',
		'import x from\n"react";\nimport y from /* c */ \'vue\';',
		'const m = import(/* chunk */ "react-dom");const r = require("react");',
		'xfrom "react"; ximport "react"; import{a}from"react-dom/client"',
		`const t = ${BT}\${s.replace(/'/g, "\\\\'")}${BT}; import z from "react";`,
		'import("react", { with: { type: "json" } });',
		"import * as v from 'vue'; import '@angular/core';"
	];
	const combined = { ...reactPaths, ...vendorPaths };
	const rewriter = compileSpecifierRewriter(combined);

	test('with sweep: union regex == legacy main + sweep', () => {
		for (const source of cases) {
			const { masked } = maskLiterals(source);
			expect(
				rewriteSpecifiers(masked, rewriter, { native: false, sweep: true })
			).toBe(legacyReactSweep(legacyReactMain(masked, combined), combined));
		}
	});

	test('without sweep: combined regex == legacy per-specifier loop', () => {
		for (const source of cases) {
			const { masked } = maskLiterals(source);
			expect(
				rewriteSpecifiers(masked, rewriter, { native: false, sweep: false })
			).toBe(legacyVendorMain(masked, combined));
			expect(jsRewriteImports(masked, sortedReplacements(combined))).toBe(
				legacyVendorMain(masked, combined)
			);
		}
	});

	test('native path: native scanner + combined sweep == legacy native + sweep', () => {
		if (!nativeAvailable) return;
		for (const source of cases) {
			const { masked } = maskLiterals(source);
			const legacyMain =
				nativeRewriteImports(masked, sortedReplacements(combined)) ??
				legacyReactMain(masked, combined);
			expect(rewriteSpecifiers(masked, rewriter, { sweep: true })).toBe(
				legacyReactSweep(legacyMain, combined)
			);
			expect(rewriteSpecifiers(masked, rewriter, { sweep: false })).toBe(
				legacyMain
			);
		}
	});
});

describe('rewriteClientOutputs — file level', () => {
	test('writes rewritten outputs and tolerates a missing file', async () => {
		const file = await writeChunk(fixture);
		const stats = await rewriteClientOutputs(
			[file, join(dir, 'gone.js')],
			{ reactPaths, refreshGlobals: true, urlFileMap, vendorPaths }
		);
		expect(stats).toEqual({ files: 1, rewritten: 1 });
		expect(await Bun.file(file).text()).toBe(expectedAll);
	});

	test('no families → nothing is read', async () => {
		const stats = await rewriteClientOutputs([join(dir, 'gone.js')], {});
		expect(stats).toEqual({ files: 0, rewritten: 0 });
	});

	test('rewriteUrlReferencesInContent skips content without URL(', () => {
		const source = 'const u = "./worker.ts";';
		expect(rewriteUrlReferencesInContent(source, urlFileMap)).toBe(source);
	});
});
