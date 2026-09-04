/** Compiled bare-specifier → vendor-path rewriter shared by every import
 *  rewrite pass (the client-output post-process, the HMR module server, the
 *  mobile preview bundle, the SSR Angular vendoring).
 *
 *  One rewriter is compiled per distinct vendor map — never per file and never
 *  per specifier — and holds a single alternation of every specifier, so the
 *  JavaScript path is O(content) per family: one `replace` with one combined
 *  regex instead of three fresh regexes and three full sweeps per specifier.
 *
 *  Three regexes are compiled:
 *  - `mainRegex`  — the adjacency forms `from "X"` / `import "X"` /
 *    `import("X")` (whitespace allowed).
 *  - `sweepRegex` — the safety net: the keyword may be separated from the
 *    opening quote by whitespace and masked comments (`from`, a masked
 *    comment, then `"X"`),
 *    plus `require("X")`. Runs on MASKED text only.
 *  - `unionRegex` — main ∪ sweep in one pass, for a family that sweeps. Every
 *    alternative re-emits its matched prefix/suffix
 *    verbatim and swaps only the specifier, so the union rewrites exactly the
 *    occurrences the sequential main-then-sweep passes did.
 *
 *  Vendor map values are URL paths (`/vendor/x.js`); they never equal a key
 *  and never contain quotes, so a rewritten specifier can't re-match. */

import { maskLiterals, SENTINEL } from './maskLiterals';

export type SpecifierRewriter = {
	lookup: Map<string, string>;
	/** Adjacency forms only. */
	mainRegex: RegExp;
	/** `"spec` / `'spec` for every specifier — the raw-content precheck. */
	quotedSpecifiers: string[];
	/** Keyword + whitespace/masked-comment gap + quote; masked text only. */
	sweepRegex: RegExp;
	/** main ∪ sweep — the single pass for a sweeping family. */
	unionRegex: RegExp;
};

export type RewriteSpecifierOptions = {
	/** Also run the masked-comment safety-net sweep. */
	sweep: boolean;
};

const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// `maskLiterals` keeps the `/* */` and `//` delimiters and turns only the
// comment body into a placeholder, so an intervening comment appears as
// `/*<ph>*/` or `//<ph>`, not a bare placeholder — tolerate all three.
const PLACEHOLDER = `${SENTINEL}\\d+${SENTINEL}`;
const GAP = `(?:\\s|${PLACEHOLDER}|/\\*${PLACEHOLDER}\\*/|//${PLACEHOLDER})*`;
const QUOTE = `["']`;

const ADJACENT_PREFIXES = [`from\\s*${QUOTE}`, `import\\s*${QUOTE}`];
const ADJACENT_DYNAMIC_PREFIX = `import\\s*\\(\\s*${QUOTE}`;
const ADJACENT_DYNAMIC_SUFFIX = `${QUOTE}\\s*\\)`;
const SWEEP_PREFIXES = [
	`\\bfrom${GAP}${QUOTE}`,
	`\\bimport${GAP}${QUOTE}`,
	`\\b(?:import|require)${GAP}\\(${GAP}${QUOTE}`
];

const rewriterCache = new Map<string, SpecifierRewriter>();

const cacheKey = (vendorPaths: Record<string, string>) =>
	Object.entries(vendorPaths)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([specifier, webPath]) => `${specifier}\0${webPath}\0`)
		.join('');

/** `(prefixes)(alt)(quote)` plus, when asked, the adjacency dynamic-import
 *  form whose suffix must include the closing paren. */
const compileRegex = (
	prefixes: string[],
	alternation: string,
	withAdjacentDynamic: boolean
) => {
	const plain = `(${prefixes.join('|')})(${alternation})(${QUOTE})`;
	if (!withAdjacentDynamic) return new RegExp(plain, 'g');
	const dynamic = `(${ADJACENT_DYNAMIC_PREFIX})(${alternation})(${ADJACENT_DYNAMIC_SUFFIX})`;

	return new RegExp(`${plain}|${dynamic}`, 'g');
};

export const compileSpecifierRewriter = (
	vendorPaths: Record<string, string>
) => {
	const key = cacheKey(vendorPaths);
	const cached = rewriterCache.get(key);
	if (cached) return cached;

	// Longest first so a specifier never partially matches a longer one.
	const replacements = Object.entries(vendorPaths).sort(
		([specA], [specB]) => specB.length - specA.length
	);
	const alternation = replacements
		.map(([specifier]) => escapeRegex(specifier))
		.join('|');
	const rewriter: SpecifierRewriter = {
		lookup: new Map(replacements),
		mainRegex: compileRegex(ADJACENT_PREFIXES, alternation, true),
		quotedSpecifiers: replacements.flatMap(([specifier]) => [
			`"${specifier}`,
			`'${specifier}`
		]),
		sweepRegex: compileRegex(SWEEP_PREFIXES, alternation, false),
		unionRegex: compileRegex(
			[...ADJACENT_PREFIXES, ...SWEEP_PREFIXES],
			alternation,
			true
		)
	};
	rewriterCache.set(key, rewriter);

	return rewriter;
};

/** Cheap raw-content precheck: a real import always has the specifier right
 *  after an opening quote, so no `"spec` / `'spec` substring means no family
 *  can match and the file can be skipped without masking it. */
export const hasSpecifierCandidate = (
	content: string,
	rewriter: SpecifierRewriter
) => rewriter.quotedSpecifiers.some((quoted) => content.includes(quoted));

const asGroup = (value: unknown) =>
	typeof value === 'string' ? value : undefined;

/** Replacer for every compiled regex: the plain alternative fills groups 1-3,
 *  the dynamic alternative groups 4-6. Prefix and suffix are re-emitted
 *  verbatim; only the specifier is swapped for its vendor path. */
const replaceSpecifier =
	(lookup: Map<string, string>) =>
	(match: string, ...groups: unknown[]) => {
		const [prefixA, specA, suffixA, prefixB, specB, suffixB] = groups;
		const prefix = asGroup(prefixA) ?? asGroup(prefixB);
		const specifier = asGroup(specA) ?? asGroup(specB);
		const suffix = asGroup(suffixA) ?? asGroup(suffixB);
		if (
			prefix === undefined ||
			specifier === undefined ||
			suffix === undefined
		)
			return match;
		const webPath = lookup.get(specifier);

		return webPath === undefined ? match : `${prefix}${webPath}${suffix}`;
	};

/** Mask → rewrite one family → restore, with the raw-content precheck. */
export const rewriteContentSpecifiers = (
	content: string,
	rewriter: SpecifierRewriter,
	options: RewriteSpecifierOptions
) => {
	if (!hasSpecifierCandidate(content, rewriter)) return content;
	// Mask template literals + comments so `from '...'` inside example-code
	// snippets isn't rewritten like a real import (would diverge from the SSR
	// output → hydration mismatch); restore them after.
	const { masked, restore } = maskLiterals(content);

	return restore(rewriteSpecifiers(masked, rewriter, options));
};

/** Rewrite the specifiers of one family in MASKED text with a single
 *  combined-regex pass. */
export const rewriteSpecifiers = (
	masked: string,
	rewriter: SpecifierRewriter,
	options: RewriteSpecifierOptions
) =>
	masked.replace(
		options.sweep ? rewriter.unionRegex : rewriter.mainRegex,
		replaceSpecifier(rewriter.lookup)
	);
