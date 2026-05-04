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
 *  the JS regex implementation), then written back to disk. The standalone
 *  iteration over a captured path list goes away. */

import type { BuildArtifact, BuildOutput } from 'bun';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeRewriteImports } from './nativeRewrite';

const escapeRegex = (str: string) =>
	str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** JS fallback: regex-based import rewriting. */
export const jsRewriteImports = (
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

/** Apply the bare-specifier → vendor-URL rewrite to a single chunk of text. */
export const rewriteImportsInContent = (
	content: string,
	vendorPaths: Record<string, string>
) => {
	if (Object.keys(vendorPaths).length === 0) return content;

	// Sort by specifier length (longest first) to avoid partial matches.
	const replacements = Object.entries(vendorPaths).sort(
		([keyA], [keyB]) => keyB.length - keyA.length
	);

	const native = nativeRewriteImports(content, replacements);

	return native ?? jsRewriteImports(content, replacements);
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
	const REEXPORT_PATTERN =
		/__reExport\(\s*[A-Za-z_$][\w$]*\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g;

	REEXPORT_PATTERN.lastIndex = 0;
	const missing: { ident: string; path: string }[] = [];
	let match;
	while ((match = REEXPORT_PATTERN.exec(content)) !== null) {
		const ident = match[1];
		if (!ident) continue;
		const nsImportRe = new RegExp(
			`\\bimport\\s*\\*\\s*as\\s+${ident}\\s+from\\b`
		);
		if (nsImportRe.test(content)) continue;
		const declRe = new RegExp(
			`\\b(?:const|let|var|function|class)\\s+${ident}\\b`
		);
		if (declRe.test(content)) continue;
		const namedImportRe = new RegExp(
			`\\bimport\\s*\\{[^}]*\\b${ident}\\b[^}]*\\}\\s*from\\b`
		);
		if (namedImportRe.test(content)) continue;

		const importPathRe =
			/(?:from\s+|import\s*)["']([^"']+)["']/g;
		let pathMatch;
		let sourcePath: string | undefined;
		while ((pathMatch = importPathRe.exec(content)) !== null) {
			const p = pathMatch[1];
			if (!p) continue;
			const base = p.split('/').pop()?.replace(/\.[mc]?js$/, '');
			if (!base) continue;
			const normalized = base.startsWith('_') ? base.slice(1) : base;
			if (normalized === ident || normalized.endsWith(`_${ident}`)) {
				sourcePath = p;
				break;
			}
		}
		if (sourcePath) missing.push({ ident, path: sourcePath });
	}

	if (missing.length === 0) return content;

	const seen = new Set<string>();
	const unique = missing.filter((entry) => {
		if (seen.has(entry.ident)) return false;
		seen.add(entry.ident);

		return true;
	});

	const inserts = unique
		.map((entry) => `import * as ${entry.ident} from "${entry.path}";`)
		.join('\n');

	return `${inserts}\n${content}`;
};

const isReadableArtifact = (artifact: BuildArtifact) =>
	artifact.path.endsWith('.js');

/** In-pipeline output rewrite. Reads each emitted .js artifact, applies the
 *  rewrite, and writes back. Operates on `BuildArtifact[]` straight off
 *  `Bun.build()`'s result so paths are guaranteed-current — no race window. */
export const rewriteBuildOutputs = async (
	outputs: BuildArtifact[],
	vendorPaths: Record<string, string>
) => {
	if (Object.keys(vendorPaths).length === 0) return;

	await Promise.all(
		outputs.filter(isReadableArtifact).map(async (artifact) => {
			let original: string;
			try {
				original = await artifact.text();
			} catch (err) {
				const code = (err as NodeJS.ErrnoException).code;
				if (code === 'ENOENT') return;
				throw err;
			}

			const rewritten = rewriteImportsInContent(original, vendorPaths);
			if (rewritten === original) return;

			try {
				await Bun.write(artifact.path, rewritten);
			} catch (err) {
				const code = (err as NodeJS.ErrnoException).code;
				if (code === 'ENOENT') return;
				throw err;
			}
		})
	);
};

/** Like `rewriteBuildOutputs`, but takes a separate per-artifact resolver to
 *  produce path maps. Used for the SSR-side @angular/* rewrite which uses
 *  paths relative to each artifact's directory. */
export const rewriteBuildOutputsWith = async (
	outputs: BuildArtifact[],
	resolveVendorPaths: (artifact: BuildArtifact) => Record<string, string>
) => {
	await Promise.all(
		outputs.filter(isReadableArtifact).map(async (artifact) => {
			const vendorPaths = resolveVendorPaths(artifact);
			if (Object.keys(vendorPaths).length === 0) return;

			let original: string;
			try {
				original = await artifact.text();
			} catch (err) {
				const code = (err as NodeJS.ErrnoException).code;
				if (code === 'ENOENT') return;
				throw err;
			}

			const rewritten = rewriteImportsInContent(original, vendorPaths);
			if (rewritten === original) return;

			try {
				await Bun.write(artifact.path, rewritten);
			} catch (err) {
				const code = (err as NodeJS.ErrnoException).code;
				if (code === 'ENOENT') return;
				throw err;
			}
		})
	);
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

	const allFiles: string[] = [];
	for (const dir of vendorDirs) {
		try {
			const entries = await readdir(dir);
			for (const entry of entries) {
				if (entry.endsWith('.js')) allFiles.push(join(dir, entry));
			}
		} catch {
			// missing dir is fine — that framework wasn't used
		}
	}

	await Promise.all(
		allFiles.map(async (filePath) => {
			let original: string;
			try {
				original = await Bun.file(filePath).text();
			} catch (err) {
				const code = (err as NodeJS.ErrnoException).code;
				if (code === 'ENOENT') return;
				throw err;
			}

			let next = rewriteImportsInContent(original, vendorPaths);
			next = fixMissingReExportNamespacesInContent(next);

			if (next === original) return;
			try {
				await Bun.write(filePath, next);
			} catch (err) {
				const code = (err as NodeJS.ErrnoException).code;
				if (code === 'ENOENT') return;
				throw err;
			}
		})
	);
};

/** Helper to wrap a `Bun.build` call so the rewrite happens in-pipeline.
 *  Use as: `const result = await buildWithImportRewrite(bunBuild(config), vendorPaths)`. */
export const buildWithImportRewrite = async (
	pendingBuild: Promise<BuildOutput>,
	vendorPaths: Record<string, string>
): Promise<BuildOutput> => {
	const result = await pendingBuild;
	if (result.outputs.length > 0) {
		await rewriteBuildOutputs(result.outputs, vendorPaths);
	}

	return result;
};
