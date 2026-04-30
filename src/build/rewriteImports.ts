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

/** Post-process every .js in one or more vendor directories using the
 *  combined cross-framework path map. Required because each vendor build
 *  externalizes packages owned by other vendor pipelines (e.g. a dep-vendor
 *  wrapper around `@sentry/angular` externalizes `@angular/core` so it isn't
 *  duplicated, leaving a bare `from "@angular/core"` in the output). Without
 *  this rewrite the browser fetches the vendor file at runtime and chokes
 *  on the bare specifier. Run AFTER all vendor builds complete so every
 *  framework's path map is included in `vendorPaths`. */
export const rewriteVendorDirectories = async (
	vendorDirs: string[],
	vendorPaths: Record<string, string>
) => {
	if (Object.keys(vendorPaths).length === 0) return;
	const { readdirSync } = await import('node:fs');
	const { join } = await import('node:path');

	const allFiles: string[] = [];
	for (const dir of vendorDirs) {
		try {
			const files = readdirSync(dir)
				.filter((f) => f.endsWith('.js'))
				.map((f) => join(dir, f));
			allFiles.push(...files);
		} catch {
			// missing dir is fine — that framework wasn't used
		}
	}

	await rewriteImports(allFiles, vendorPaths);
	await fixMissingReExportNamespaces(allFiles);
};

/** Workaround for a Bun bundler bug: when a module does both
 *  `import { x } from 'X'` AND `export * from 'X'`, and `X` is externalized,
 *  Bun synthesizes a `__reExport(exports_Y, ns)` call but drops the
 *  corresponding `import * as ns from "X"` declaration. The resulting chunk
 *  references an undeclared identifier and crashes at module evaluation.
 *
 *  This step detects the pattern and injects the missing namespace import.
 *  The source path is recovered from a sibling named-import in the same
 *  chunk (Bun keeps that intact). */
const fixMissingReExportNamespaces = async (files: string[]) => {
	const REEXPORT_PATTERN = /__reExport\(\s*[A-Za-z_$][\w$]*\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g;

	await Promise.all(
		files.map(async (filePath) => {
			const content = await Bun.file(filePath).text();
			REEXPORT_PATTERN.lastIndex = 0;
			const missing: { ident: string; path: string }[] = [];
			let match;
			while ((match = REEXPORT_PATTERN.exec(content)) !== null) {
				const ident = match[1];
				if (!ident) continue;
				// Already imported as a namespace? Skip.
				const nsImportRe = new RegExp(
					`\\bimport\\s*\\*\\s*as\\s+${ident}\\s+from\\b`
				);
				if (nsImportRe.test(content)) continue;
				// Already declared as a local binding? Skip.
				const declRe = new RegExp(
					`\\b(?:const|let|var|function|class)\\s+${ident}\\b`
				);
				if (declRe.test(content)) continue;
				// Also skip if it's brought in via named import (rare but possible).
				const namedImportRe = new RegExp(
					`\\bimport\\s*\\{[^}]*\\b${ident}\\b[^}]*\\}\\s*from\\b`
				);
				if (namedImportRe.test(content)) continue;
				// Find the source path: heuristic — look for a sibling
				// `import { ... } from "<path>"` whose basename, with separators
				// turned into underscores, ends with the ident.
				// e.g. `firebase_app.js` matches `app`; `rxjs_operators.js`
				// matches `operators`; `angular_core.js` matches `core`.
				const importPathRe = /from\s+["']([^"']+)["']/g;
				let pathMatch;
				let sourcePath: string | undefined;
				while ((pathMatch = importPathRe.exec(content)) !== null) {
					const p = pathMatch[1];
					if (!p) continue;
					const base = p.split('/').pop()?.replace(/\.[mc]?js$/, '');
					if (!base) continue;
					if (base === ident || base.endsWith(`_${ident}`)) {
						sourcePath = p;
						break;
					}
				}
				if (sourcePath) {
					missing.push({ ident, path: sourcePath });
				}
			}

			if (missing.length === 0) return;

			// Dedupe (same ident shouldn't appear twice but be defensive).
			const seen = new Set<string>();
			const unique = missing.filter((entry) => {
				if (seen.has(entry.ident)) return false;
				seen.add(entry.ident);

				return true;
			});

			const inserts = unique
				.map((entry) => `import * as ${entry.ident} from "${entry.path}";`)
				.join('\n');
			// Insert at the very top — ESM spec hoists imports anyway, so
			// position doesn't matter for execution order.
			const patched = `${inserts}\n${content}`;
			await Bun.write(filePath, patched);
		})
	);
};
