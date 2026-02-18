/** Post-process bundled output files to rewrite bare React specifiers
 *  (e.g. `from "react"`) to stable vendor paths (e.g. `from "/vendor/react.js"`).
 *
 *  This runs after Bun.build() when React is marked as external in dev mode.
 *  Bun preserves bare specifiers for external packages, but browsers can't
 *  resolve them. Rewriting to absolute URL paths lets the browser load
 *  the pre-built vendor files directly. */

const escapeRegex = (str: string): string =>
	str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const rewriteReactImports = async (
	outputPaths: string[],
	vendorPaths: Record<string, string>
): Promise<void> => {
	const jsFiles = outputPaths.filter((path) => path.endsWith('.js'));
	if (jsFiles.length === 0) return;

	// Build replacement pairs sorted by specifier length (longest first)
	// to avoid partial matches like "react" matching before "react-dom"
	const replacements = Object.entries(vendorPaths).sort(
		([keyA], [keyB]) => keyB.length - keyA.length
	);

	for (const filePath of jsFiles) {
		let content = await Bun.file(filePath).text();
		let modified = false;

		for (const [specifier, webPath] of replacements) {
			const escaped = escapeRegex(specifier);

			// Match ES import: from "react" / from 'react' / from"react"
			const fromRegex = new RegExp(`(from\\s*["'])${escaped}(["'])`, 'g');
			const newContent = content.replace(fromRegex, `$1${webPath}$2`);

			if (newContent !== content) {
				content = newContent;
				modified = true;
			}

			// Match dynamic import: import("react") / import('react')
			const dynamicRegex = new RegExp(
				`(import\\s*\\(\\s*["'])${escaped}(["']\\s*\\))`,
				'g'
			);
			const newContent2 = content.replace(dynamicRegex, `$1${webPath}$2`);

			if (newContent2 !== content) {
				content = newContent2;
				modified = true;
			}
		}

		if (modified) {
			await Bun.write(filePath, content);
		}
	}
};
