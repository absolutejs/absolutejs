/** Single post-process pass over client build outputs.
 *
 *  Replaces the four separate passes that each read, `maskLiterals`-masked,
 *  rewrote and wrote back every client output (react imports → refresh
 *  globals → vendor imports → url references). Each output is now read once,
 *  masked once, run through every applicable rewrite family in that same
 *  order, restored once and written once — and only when something changed.
 *
 *  A family is skipped for a file when a cheap `includes()` precheck on the
 *  raw content proves nothing can match (no `"spec`/`'spec` substring for an
 *  import family, no `$RefreshReg$(`/`$RefreshSig$(` for refresh globals, no
 *  `URL(` for url references); a file with no applicable family is never
 *  masked or written.
 *
 *  Output is byte-for-byte what the sequential passes produced:
 *  - The refresh stubs contain no import or url pattern, so prepending them
 *    before or after the import families is the same.
 *  - Vendor paths contain no quotes, backticks or comment openers, so masking
 *    once and running both import families on the same masked text tokenizes
 *    exactly like re-masking the react-rewritten output did.
 *  - Url references are rewritten on the restored (unmasked) text, exactly as
 *    the old standalone pass did on the raw file.
 *  - A vendor entry whose specifier the react family already maps to the same
 *    path is dropped (`reduceVendorPaths`): the react family rewrote every
 *    occurrence, so the vendor family could never match it again. In the
 *    build pipeline this makes the vendor family empty — it was a no-op. */

import { basename } from 'node:path';
import { maskLiterals } from './maskLiterals';
import { needsRefreshStubs, REFRESH_STUBS } from './rewriteReactImports';
import {
	compileSpecifierRewriter,
	hasSpecifierCandidate,
	rewriteSpecifiers,
	type SpecifierRewriter
} from './specifierRewriter';

export type ClientRewriteOptions = {
	/** React/vendor externals rewritten with the masked-comment sweep. */
	reactPaths?: Record<string, string>;
	/** Prepend the `$RefreshReg$`/`$RefreshSig$` stubs (dev builds only). */
	refreshGlobals?: boolean;
	/** `new URL('./x', import.meta.url)` targets → served/hashed URLs. */
	urlFileMap?: Map<string, string>;
	/** Framework vendor externals rewritten without the sweep. */
	vendorPaths?: Record<string, string>;
};

export type ClientRewriteStats = {
	/** Outputs that were read (an applicable family existed). */
	files: number;
	/** Outputs whose content changed and were written back. */
	rewritten: number;
};

export type ClientRewriteFamilies = {
	react?: SpecifierRewriter;
	refreshGlobals: boolean;
	urlFileMap?: Map<string, string>;
	vendor?: SpecifierRewriter;
};

/** Vendor entries the react family does not already rewrite identically. */
export const reduceVendorPaths = (
	vendorPaths: Record<string, string>,
	reactPaths: Record<string, string>
) =>
	Object.fromEntries(
		Object.entries(vendorPaths).filter(
			([specifier, webPath]) => reactPaths[specifier] !== webPath
		)
	);

const hasEntries = (paths: Record<string, string>) =>
	Object.keys(paths).length > 0;

export const compileClientRewriteFamilies = (
	options: ClientRewriteOptions
): ClientRewriteFamilies => {
	const reactPaths = options.reactPaths ?? {};
	const react = hasEntries(reactPaths)
		? compileSpecifierRewriter(reactPaths)
		: undefined;
	const vendorPaths = reduceVendorPaths(
		options.vendorPaths ?? {},
		react ? reactPaths : {}
	);
	const vendor = hasEntries(vendorPaths)
		? compileSpecifierRewriter(vendorPaths)
		: undefined;

	return {
		react,
		refreshGlobals: options.refreshGlobals === true,
		urlFileMap: options.urlFileMap,
		vendor
	};
};

const hasAnyFamily = (families: ClientRewriteFamilies) =>
	families.react !== undefined ||
	families.vendor !== undefined ||
	families.refreshGlobals ||
	families.urlFileMap !== undefined;

/** One mask/restore for both import families (react first, then vendor). */
const rewriteImportFamilies = (
	content: string,
	react: SpecifierRewriter | undefined,
	vendor: SpecifierRewriter | undefined
) => {
	const { masked, restore } = maskLiterals(content);
	const afterReact = react
		? rewriteSpecifiers(masked, react, { sweep: true })
		: masked;
	const afterVendor = vendor
		? rewriteSpecifiers(afterReact, vendor, { sweep: false })
		: afterReact;

	return restore(afterVendor);
};

/** Apply every applicable family to one output's content, in the order the
 *  standalone passes ran. Returns the same string instance when nothing
 *  matched, so callers can skip the write. */
export const rewriteClientContent = (
	original: string,
	families: ClientRewriteFamilies,
	isJavaScript: boolean
) => {
	const react =
		isJavaScript &&
		families.react &&
		hasSpecifierCandidate(original, families.react)
			? families.react
			: undefined;
	const vendor =
		isJavaScript &&
		families.vendor &&
		hasSpecifierCandidate(original, families.vendor)
			? families.vendor
			: undefined;
	const refresh =
		isJavaScript && families.refreshGlobals && needsRefreshStubs(original);

	let content = original;
	if (react || vendor)
		content = rewriteImportFamilies(content, react, vendor);
	if (refresh) content = REFRESH_STUBS + content;
	if (families.urlFileMap)
		content = rewriteUrlReferencesInContent(content, families.urlFileMap);

	return content;
};

const isMissingFile = (error: unknown) =>
	error instanceof Error && 'code' in error && error.code === 'ENOENT';

// A rebuild may sweep an output between scheduling and read/write; a missing
// file is not an error for a post-process pass.
const readOutput = async (outputPath: string) => {
	try {
		return await Bun.file(outputPath).text();
	} catch (error) {
		if (isMissingFile(error)) return undefined;
		throw error;
	}
};

const writeOutput = async (outputPath: string, content: string) => {
	try {
		await Bun.write(outputPath, content);
	} catch (error) {
		if (isMissingFile(error)) return;
		throw error;
	}
};

const rewriteClientOutput = async (
	outputPath: string,
	families: ClientRewriteFamilies,
	stats: ClientRewriteStats
) => {
	const isJavaScript = outputPath.endsWith('.js');
	// Only url references apply to non-JS outputs (co-emitted CSS, maps).
	if (!isJavaScript && families.urlFileMap === undefined) return;
	const original = await readOutput(outputPath);
	if (original === undefined) return;
	stats.files += 1;

	const content = rewriteClientContent(original, families, isJavaScript);
	if (content === original) return;
	stats.rewritten += 1;
	await writeOutput(outputPath, content);
};

/** Run the combined pass over one group of client outputs. `stats` is
 *  accumulated in place so several groups can share one trace phase. */
export const rewriteClientOutputs = async (
	outputPaths: string[],
	options: ClientRewriteOptions,
	stats: ClientRewriteStats = { files: 0, rewritten: 0 }
) => {
	const families = compileClientRewriteFamilies(options);
	if (outputPaths.length === 0 || !hasAnyFamily(families)) return stats;

	await Promise.all(
		outputPaths.map((outputPath) =>
			rewriteClientOutput(outputPath, families, stats)
		)
	);

	return stats;
};

const URL_REFERENCE_PATTERN =
	/new\s+URL\(\s*["'](\.\.?\/[^"']+)["']\s*,\s*import\.meta\.url\s*\)/g;

/** In dev, `new URL('./path', import.meta.url)` → `/@src/...` so workers
 *  resolve through the module server; in prod → the hashed output path. */
export const rewriteUrlReferencesInContent = (
	content: string,
	urlFileMap: Map<string, string>
) => {
	if (!content.includes('URL(')) return content;

	return content.replace(URL_REFERENCE_PATTERN, (match, relPath: string) => {
		const resolvedPath = urlFileMap.get(basename(relPath));
		if (!resolvedPath) return match;

		return `new URL('${resolvedPath}', import.meta.url)`;
	});
};
