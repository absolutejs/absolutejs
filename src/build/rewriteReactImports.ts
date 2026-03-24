/** Post-process bundled output files to rewrite bare React specifiers
 *  (e.g. `from "react"`) to stable vendor paths (e.g. `from "/vendor/react.js"`).
 *
 *  Uses native Zig scanner when available (15x faster on large files),
 *  falls back to JS regex on Windows or when native addon is missing. */

import { nativeRewriteImports } from './nativeRewrite';

const escapeRegex = (str: string) =>
	str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type CompiledRewriter = {
	fromRegex: RegExp;
	sideEffectRegex: RegExp;
	dynamicRegex: RegExp;
	lookup: Map<string, string>;
};

const rewriterCache = new Map<string, CompiledRewriter>();

const cacheKey = (vendorPaths: Record<string, string>) => {
	const entries = Object.entries(vendorPaths).sort(([a], [b]) =>
		a.localeCompare(b)
	);
	let key = '';
	for (const [k, v] of entries) {
		key += `${k}\0${v}\0`;
	}
	return key;
};

const getOrCompileRewriter = (vendorPaths: Record<string, string>) => {
	const key = cacheKey(vendorPaths);
	const cached = rewriterCache.get(key);
	if (cached) return cached;

	const replacements = Object.entries(vendorPaths).sort(
		([keyA], [keyB]) => keyB.length - keyA.length
	);

	const lookup = new Map<string, string>(replacements);
	const alt = replacements.map(([spec]) => escapeRegex(spec)).join('|');

	const fromRegex = new RegExp(`(from\\s*["'])(${alt})(["'])`, 'g');
	const sideEffectRegex = new RegExp(
		`(import\\s*["'])(${alt})(["']\\s*;?)`,
		'g'
	);
	const dynamicRegex = new RegExp(
		`(import\\s*\\(\\s*["'])(${alt})(["']\\s*\\))`,
		'g'
	);

	const rewriter: CompiledRewriter = {
		dynamicRegex,
		fromRegex,
		lookup,
		sideEffectRegex
	};
	rewriterCache.set(key, rewriter);
	return rewriter;
};

const applyAllReplacements = (
	content: string,
	rewriter: CompiledRewriter
) => {
	const replacer = (
		_match: string,
		prefix: string,
		specifier: string,
		suffix: string
	) => {
		const webPath = rewriter.lookup.get(specifier);
		if (!webPath) return _match;
		return `${prefix}${webPath}${suffix}`;
	};

	rewriter.fromRegex.lastIndex = 0;
	rewriter.sideEffectRegex.lastIndex = 0;
	rewriter.dynamicRegex.lastIndex = 0;

	let result = content;
	result = result.replace(rewriter.fromRegex, replacer);
	result = result.replace(rewriter.sideEffectRegex, replacer);
	result = result.replace(rewriter.dynamicRegex, replacer);
	return result;
};

/** Bun's reactFastRefresh transform injects bare $RefreshReg$/$RefreshSig$
 *  calls into component code. With code splitting, component chunks can
 *  evaluate before the chunk containing reactRefreshSetup (which defines
 *  the globals), because Bun doesn't guarantee chunk import order matches
 *  source import order. Prepending no-op stubs to affected chunks ensures
 *  the globals always exist. The real react-refresh runtime overrides them. */
const REFRESH_STUBS =
	'window.$RefreshReg$||(window.$RefreshReg$=function(){});' +
	'window.$RefreshSig$||(window.$RefreshSig$=function(){return function(t){return t}});\n';

export const patchRefreshGlobals = async (outputPaths: string[]) => {
	const jsFiles = outputPaths.filter((path) => path.endsWith('.js'));

	await Promise.all(
		jsFiles.map(async (filePath) => {
			const content = await Bun.file(filePath).text();
			if (
				!content.includes('$RefreshReg$(') &&
				!content.includes('$RefreshSig$(')
			)
				return;
			if (content.startsWith('window.$RefreshReg$')) return;
			await Bun.write(filePath, REFRESH_STUBS + content);
		})
	);
};

export const rewriteReactImports = async (
	outputPaths: string[],
	vendorPaths: Record<string, string>
) => {
	const jsFiles = outputPaths.filter((path) => path.endsWith('.js'));
	if (jsFiles.length === 0) return;

	const rewriter = getOrCompileRewriter(vendorPaths);

	const replacements = Object.entries(vendorPaths).sort(
		([keyA], [keyB]) => keyB.length - keyA.length
	);

	await Promise.all(
		jsFiles.map(async (filePath) => {
			const original = await Bun.file(filePath).text();

			// Try native Zig scanner first (15x faster on large files)
			const native = nativeRewriteImports(original, replacements);
			const content =
				native ?? applyAllReplacements(original, rewriter);

			if (content !== original) {
				await Bun.write(filePath, content);
			}
		})
	);
};
