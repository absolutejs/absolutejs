/** Post-process bundled output files to rewrite bare specifiers
 *  (e.g. `from "@angular/core"`) to stable vendor paths
 *  (e.g. `from "/angular/vendor/angular_core.js"`).
 *
 *  Uses native Zig scanner (15x faster) when available, falls back
 *  to JS regex on Windows or when the native addon is missing. */

import { nativeRewriteImports } from './nativeRewrite';

const escapeRegex = (str: string) =>
	str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** JS fallback: regex-based import rewriting */
const jsRewriteImports = (
	content: string,
	replacements: [string, string][]
) => {
	let result = content;

	for (const [specifier, webPath] of replacements) {
		const escaped = escapeRegex(specifier);
		const fromRegex = new RegExp(
			`(from\\s*["'])${escaped}(["'])`,
			'g'
		);
		const sideEffectRegex = new RegExp(
			`(import\\s*["'])${escaped}(["'])`,
			'g'
		);
		const dynamicRegex = new RegExp(
			`(import\\s*\\(\\s*["'])${escaped}(["']\\s*\\))`,
			'g'
		);
		result = result.replace(fromRegex, `$1${webPath}$2`);
		result = result.replace(sideEffectRegex, `$1${webPath}$2`);
		result = result.replace(dynamicRegex, `$1${webPath}$2`);
	}

	return result;
};

export const rewriteImports = async (
	outputPaths: string[],
	vendorPaths: Record<string, string>
) => {
	const jsFiles = outputPaths.filter((path) => path.endsWith('.js'));
	if (jsFiles.length === 0) return;

	// Sort by specifier length (longest first) to avoid partial matches
	const replacements = Object.entries(vendorPaths).sort(
		([keyA], [keyB]) => keyB.length - keyA.length
	);

	await Promise.all(
		jsFiles.map(async (filePath) => {
			const original = await Bun.file(filePath).text();

			// Try native Zig scanner first (15x faster on large files)
			const native = nativeRewriteImports(original, replacements);
			const content = native ?? jsRewriteImports(original, replacements);

			if (content !== original) {
				await Bun.write(filePath, content);
			}
		})
	);
};
