/** Post-process bundled output files to rewrite bare React specifiers
 *  (e.g. `from "react"`) to stable vendor paths (e.g. `from "/vendor/react.js"`).
 *
 *  This runs after Bun.build() when React is marked as external in dev mode.
 *  Bun preserves bare specifiers for external packages, but browsers can't
 *  resolve them. Rewriting to absolute URL paths lets the browser load
 *  the pre-built vendor files directly. */

const escapeRegex = (str: string) =>
	str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const applyAllReplacements = (
	content: string,
	replacements: [string, string][]
) => {
	let result = content;

	for (const [specifier, webPath] of replacements) {
		const escaped = escapeRegex(specifier);

		// Match ES import: from "react" / from 'react' / from"react"
		const fromRegex = new RegExp(`(from\\s*["'])${escaped}(["'])`, 'g');
		result = result.replace(fromRegex, `$1${webPath}$2`);

		// Match bare side-effect import: import"react" / import 'react';
		// (used by _refresh.tsx which imports React for code-splitting)
		const bareRegex = new RegExp(
			`(import\\s*["'])${escaped}(["']\\s*;?)`,
			'g'
		);
		result = result.replace(bareRegex, `$1${webPath}$2`);

		// Match dynamic import: import("react") / import('react')
		const dynamicRegex = new RegExp(
			`(import\\s*\\(\\s*["'])${escaped}(["']\\s*\\))`,
			'g'
		);
		result = result.replace(dynamicRegex, `$1${webPath}$2`);
	}

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

	// Build replacement pairs sorted by specifier length (longest first)
	// to avoid partial matches like "react" matching before "react-dom"
	const replacements = Object.entries(vendorPaths).sort(
		([keyA], [keyB]) => keyB.length - keyA.length
	);

	await Promise.all(
		jsFiles.map(async (filePath) => {
			const original = await Bun.file(filePath).text();
			const content = applyAllReplacements(original, replacements);

			if (content !== original) {
				await Bun.write(filePath, content);
			}
		})
	);
};
