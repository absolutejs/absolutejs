/** Post-process bundled output files to rewrite bare specifiers
 *  (e.g. `from "@angular/core"`) to stable vendor paths
 *  (e.g. `from "/angular/vendor/angular_core.js"`).
 *
 *  This runs after Bun.build() when packages are marked as external
 *  in dev mode. Bun preserves bare specifiers for external packages,
 *  but browsers can't resolve them. Rewriting to absolute URL paths
 *  lets the browser load the pre-built vendor files directly. */

const escapeRegex = (str: string): string =>
	str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Apply a regex replacement, returning new content (tracks changes via reference comparison) */
const applyReplace = (
	content: string,
	regex: RegExp,
	replacement: string
): string => content.replace(regex, replacement);

export const rewriteImports = async (
	outputPaths: string[],
	vendorPaths: Record<string, string>
): Promise<void> => {
	const jsFiles = outputPaths.filter((path) => path.endsWith('.js'));
	if (jsFiles.length === 0) return;

	// Build replacement pairs sorted by specifier length (longest first)
	// to avoid partial matches like "@angular/common" matching before
	// "@angular/common/http"
	const replacements = Object.entries(vendorPaths).sort(
		([keyA], [keyB]) => keyB.length - keyA.length
	);

	for (const filePath of jsFiles) {
		const original = await Bun.file(filePath).text();
		let content = original;

		for (const [specifier, webPath] of replacements) {
			const escaped = escapeRegex(specifier);

			// Match ES import: from "@angular/core" / from '@angular/core'
			const fromRegex = new RegExp(
				`(from\\s*["'])${escaped}(["'])`,
				'g'
			);
			content = applyReplace(content, fromRegex, `$1${webPath}$2`);

			// Match side-effect import: import "@angular/compiler"
			// Bun preserves these for externalized packages.
			const sideEffectRegex = new RegExp(
				`(import\\s*["'])${escaped}(["'])`,
				'g'
			);
			content = applyReplace(
				content,
				sideEffectRegex,
				`$1${webPath}$2`
			);

			// Match dynamic import: import("@angular/core")
			const dynamicRegex = new RegExp(
				`(import\\s*\\(\\s*["'])${escaped}(["']\\s*\\))`,
				'g'
			);
			content = applyReplace(
				content,
				dynamicRegex,
				`$1${webPath}$2`
			);

		}

		if (content !== original) {
			await Bun.write(filePath, content);
		}
	}
};
