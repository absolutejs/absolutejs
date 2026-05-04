/** Compatibility shim — the rewrite logic moved to
 *  `rewriteImportsPlugin.ts` where it runs in-pipeline against
 *  `BuildArtifact[]` straight off `Bun.build()`'s result. Existing callers
 *  that still pass a list of file paths route through this thin wrapper.
 *  The new in-pipeline call site is `rewriteBuildOutputs`/`buildWithImportRewrite`
 *  in `rewriteImportsPlugin.ts`. */

import {
	rewriteImportsInContent,
	rewriteVendorDirectories as rewriteVendorDirectoriesImpl
} from './rewriteImportsPlugin';

export const rewriteImports = async (
	outputPaths: string[],
	vendorPaths: Record<string, string>
) => {
	const jsFiles = outputPaths.filter((path) => path.endsWith('.js'));
	if (jsFiles.length === 0) return;
	if (Object.keys(vendorPaths).length === 0) return;

	await Promise.all(
		jsFiles.map(async (filePath) => {
			let original: string;
			try {
				original = await Bun.file(filePath).text();
			} catch (err) {
				const code = (err as NodeJS.ErrnoException).code;
				// ENOENT: file already swept by the next build cycle. The
				// rewrite is for the build that just completed, but the
				// next build is already in progress and will re-rewrite.
				if (code === 'ENOENT') return;
				throw err;
			}

			const rewritten = rewriteImportsInContent(original, vendorPaths);
			if (rewritten === original) return;

			try {
				await Bun.write(filePath, rewritten);
			} catch (err) {
				const code = (err as NodeJS.ErrnoException).code;
				if (code === 'ENOENT') return;
				throw err;
			}
		})
	);
};

export const rewriteVendorDirectories = rewriteVendorDirectoriesImpl;
