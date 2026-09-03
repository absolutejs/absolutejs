/** Post-process bundled output files to rewrite bare React specifiers
 *  (e.g. `from "react"`) to stable vendor paths (e.g. `from "/vendor/react.js"`).
 *
 *  Uses the native Zig scanner when available (15x faster on large files),
 *  falls back to a single combined-regex JS pass otherwise. The build pipeline
 *  runs this family through `rewriteClientOutputs` (one read/mask/write per
 *  file together with the other rewrite families); the standalone functions
 *  here stay for callers that only need one family. */

import {
	compileSpecifierRewriter,
	rewriteContentSpecifiers
} from './specifierRewriter';

/** Bun's reactFastRefresh transform injects bare $RefreshReg$/$RefreshSig$
 *  calls into component code. With code splitting, component chunks can
 *  evaluate before the chunk containing reactRefreshSetup (which defines
 *  the globals), because Bun doesn't guarantee chunk import order matches
 *  source import order. Prepending no-op stubs to affected chunks ensures
 *  the globals always exist. The real react-refresh runtime overrides them. */
export const REFRESH_STUBS =
	'window.$RefreshReg$||(window.$RefreshReg$=function(){});' +
	'window.$RefreshSig$||(window.$RefreshSig$=function(){return function(t){return t}});\n';

/** A chunk needs the stubs when it calls a refresh global and has not been
 *  patched already. */
export const needsRefreshStubs = (content: string) =>
	(content.includes('$RefreshReg$(') || content.includes('$RefreshSig$(')) &&
	!content.startsWith('window.$RefreshReg$');

export const patchRefreshGlobals = async (outputPaths: string[]) => {
	const jsFiles = outputPaths.filter((path) => path.endsWith('.js'));

	await Promise.all(
		jsFiles.map(async (filePath) => {
			const content = await Bun.file(filePath).text();
			if (!needsRefreshStubs(content)) return;
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

	const rewriter = compileSpecifierRewriter(vendorPaths);

	await Promise.all(
		jsFiles.map(async (filePath) => {
			const original = await Bun.file(filePath).text();
			// Native main pass + safety-net sweep for any real import the main
			// pass skipped (keyword separated from its specifier by a masked
			// comment / whitespace); single union-regex pass without native.
			const content = rewriteContentSpecifiers(original, rewriter, {
				sweep: true
			});

			if (content !== original) {
				await Bun.write(filePath, content);
			}
		})
	);
};
