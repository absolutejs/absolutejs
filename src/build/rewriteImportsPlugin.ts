/** In-pipeline import rewriter for Bun.build outputs.
 *
 *  Replaces the previous post-build `rewriteImports` + `rewriteVendorDirectories`
 *  passes that walked file paths captured at scheduling time and read them off
 *  disk later — a race window where the next rebuild could sweep a path between
 *  capture and read, producing ENOENT.
 *
 *  Now: the rewrite operates on the `BuildArtifact` outputs returned by
 *  `Bun.build()` itself, in the same await chain. Each output's content is
 *  transformed (using the native Zig scanner when available, falling back to
 *  a single combined-regex JS pass), then written back to disk. The standalone
 *  iteration over a captured path list goes away.
 *
 *  The main build pipeline no longer calls `rewriteBuildOutputs` for client
 *  outputs — `rewriteClientOutputs` folds this family into its single pass. */

import type { BuildArtifact, BuildOutput } from 'bun';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
	compileSpecifierRewriter,
	rewriteContentSpecifiers,
	rewriteSpecifiers
} from './specifierRewriter';

type MissingNamespaceImport = { ident: string; path: string };

const REEXPORT_PATTERN =
	/__reExport\(\s*[A-Za-z_$][\w$]*\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g;
const IMPORT_PATH_PATTERN = /(?:from\s+|import\s*)["']([^"']+)["']/g;

const isMissingFile = (error: unknown) =>
	error instanceof Error && 'code' in error && error.code === 'ENOENT';

/** Helper to wrap a `Bun.build` call so the rewrite happens in-pipeline.
 *  Use as: `const result = await buildWithImportRewrite(bunBuild(config), vendorPaths)`. */
export const buildWithImportRewrite = async (
	pendingBuild: Promise<BuildOutput>,
	vendorPaths: Record<string, string>
) => {
	const result = await pendingBuild;
	if (result.outputs.length > 0) {
		await rewriteBuildOutputs(result.outputs, vendorPaths);
	}

	return result;
};

/** Workaround for a Bun bundler bug: when a module does both
 *  `import { x } from 'X'` AND `export * from 'X'`, and `X` is externalized,
 *  Bun synthesizes a `__reExport(exports_Y, ns)` call but drops the
 *  corresponding `import * as ns from "X"` declaration. The resulting chunk
 *  references an undeclared identifier and crashes at module evaluation.
 *
 *  Detects the pattern and injects the missing namespace import. The source
 *  path is recovered from a sibling named-import in the same chunk (Bun keeps
 *  that intact). */
export const fixMissingReExportNamespacesInContent = (content: string) => {
	const missing = collectMissingNamespaceImports(content);
	if (missing.length === 0) return content;

	const inserts = missing
		.map((entry) => `import * as ${entry.ident} from "${entry.path}";`)
		.join('\n');

	return `${inserts}\n${content}`;
};

/** Is `ident` already declared or imported (in any form) in this chunk? */
const isIdentifierBound = (content: string, ident: string) => {
	const nsImportRe = new RegExp(
		`\\bimport\\s*\\*\\s*as\\s+${ident}\\s+from\\b`
	);
	const declRe = new RegExp(
		`\\b(?:const|let|var|function|class)\\s+${ident}\\b`
	);
	const namedImportRe = new RegExp(
		`\\bimport\\s*\\{[^}]*\\b${ident}\\b[^}]*\\}\\s*from\\b`
	);

	return (
		nsImportRe.test(content) ||
		declRe.test(content) ||
		namedImportRe.test(content)
	);
};

/** Bun keeps a sibling named import from the same module in the chunk; its
 *  path's basename (minus extension and a leading `_`) matches the dropped
 *  namespace identifier, or ends with `_${ident}`. */
const findNamespaceSourcePath = (content: string, ident: string) => {
	IMPORT_PATH_PATTERN.lastIndex = 0;
	for (const [, importPath] of content.matchAll(IMPORT_PATH_PATTERN)) {
		if (!importPath) continue;
		const base = importPath
			.split('/')
			.pop()
			?.replace(/\.[mc]?js$/, '');
		if (!base) continue;
		const normalized = base.startsWith('_') ? base.slice(1) : base;
		if (normalized === ident || normalized.endsWith(`_${ident}`)) {
			return importPath;
		}
	}

	return undefined;
};

const collectMissingNamespaceImports = (content: string) => {
	REEXPORT_PATTERN.lastIndex = 0;
	const missing: MissingNamespaceImport[] = [];
	const seen = new Set<string>();
	for (const [, ident] of content.matchAll(REEXPORT_PATTERN)) {
		if (!ident || seen.has(ident)) continue;
		if (isIdentifierBound(content, ident)) continue;
		const sourcePath = findNamespaceSourcePath(content, ident);
		if (!sourcePath) continue;
		seen.add(ident);
		missing.push({ ident, path: sourcePath });
	}

	return missing;
};

/** One combined-regex pass over the (already masked) content — O(content),
 *  not O(specifiers × content). Exported for tests. */
export const jsRewriteImports = (
	content: string,
	replacements: [string, string][]
) =>
	rewriteSpecifiers(
		content,
		compileSpecifierRewriter(Object.fromEntries(replacements)),
		{ sweep: false }
	);

/** In-pipeline output rewrite. Reads each emitted .js artifact, applies the
 *  rewrite, and writes back. Operates on `BuildArtifact[]` straight off
 *  `Bun.build()`'s result so paths are guaranteed-current — no race window. */
export const rewriteBuildOutputs = async (
	outputs: BuildArtifact[],
	vendorPaths: Record<string, string>
) => {
	if (Object.keys(vendorPaths).length === 0) return;

	await Promise.all(
		outputs
			.filter(isReadableArtifact)
			.map((artifact) => rewriteArtifact(artifact, vendorPaths))
	);
};

const isReadableArtifact = (artifact: BuildArtifact) =>
	artifact.path.endsWith('.js');

// A rebuild may sweep an output between scheduling and read/write; a missing
// file is not an error for a post-process pass.
const readArtifactText = async (artifact: BuildArtifact) => {
	try {
		return await artifact.text();
	} catch (error) {
		if (isMissingFile(error)) return undefined;
		throw error;
	}
};

const readFileText = async (filePath: string) => {
	try {
		return await Bun.file(filePath).text();
	} catch (error) {
		if (isMissingFile(error)) return undefined;
		throw error;
	}
};

const writeFileText = async (filePath: string, content: string) => {
	try {
		await Bun.write(filePath, content);
	} catch (error) {
		if (isMissingFile(error)) return;
		throw error;
	}
};

const rewriteArtifact = async (
	artifact: BuildArtifact,
	vendorPaths: Record<string, string>
) => {
	if (Object.keys(vendorPaths).length === 0) return;
	const original = await readArtifactText(artifact);
	if (original === undefined) return;

	const rewritten = rewriteImportsInContent(original, vendorPaths);
	if (rewritten === original) return;
	await writeFileText(artifact.path, rewritten);
};

/** Like `rewriteBuildOutputs`, but takes a separate per-artifact resolver to
 *  produce path maps. Used for the SSR-side @angular/* rewrite which uses
 *  paths relative to each artifact's directory. */
export const rewriteBuildOutputsWith = async (
	outputs: BuildArtifact[],
	resolveVendorPaths: (artifact: BuildArtifact) => Record<string, string>
) => {
	await Promise.all(
		outputs
			.filter(isReadableArtifact)
			.map((artifact) =>
				rewriteArtifact(artifact, resolveVendorPaths(artifact))
			)
	);
};

/** Apply the bare-specifier → vendor-URL rewrite to a single chunk of text. */
export const rewriteImportsInContent = (
	content: string,
	vendorPaths: Record<string, string>
) => {
	if (Object.keys(vendorPaths).length === 0) return content;

	return rewriteContentSpecifiers(
		content,
		compileSpecifierRewriter(vendorPaths),
		{ sweep: false }
	);
};

const listJsFiles = async (dir: string) => {
	try {
		const entries = await readdir(dir);

		return entries
			.filter((entry) => entry.endsWith('.js'))
			.map((entry) => join(dir, entry));
	} catch {
		// missing dir is fine — that framework wasn't used
		return [];
	}
};

const rewriteVendorFile = async (
	filePath: string,
	vendorPaths: Record<string, string>
) => {
	const original = await readFileText(filePath);
	if (original === undefined) return;

	const next = fixMissingReExportNamespacesInContent(
		rewriteImportsInContent(original, vendorPaths)
	);
	if (next === original) return;
	await writeFileText(filePath, next);
};

/** Apply the rewrite + re-export fix to every .js file inside a list of
 *  vendor directories. Used after vendor builds where each pipeline emits
 *  files that may externalize specifiers owned by another pipeline.
 *
 *  This still walks the directory because the cross-vendor rewrite happens
 *  AFTER all vendor builds complete (so every framework's path map is
 *  available) — it doesn't have a single `BuildArtifact[]` to operate on.
 *  ENOENT during read/write is tolerated for the same race-protection
 *  reason as the in-pipeline path. */
export const rewriteVendorDirectories = async (
	vendorDirs: string[],
	vendorPaths: Record<string, string>
) => {
	if (Object.keys(vendorPaths).length === 0) return;

	const fileLists = await Promise.all(vendorDirs.map(listJsFiles));
	await Promise.all(
		fileLists
			.flat()
			.map((filePath) => rewriteVendorFile(filePath, vendorPaths))
	);
};
