/* SSR Angular core multi-instance guardrail.
 *
 * Background (see ABSOLUTEJS_ANGULAR_HMR.md §3.9): when an SSR
 * build ends up loading two distinct `@angular/core` module
 * instances at runtime, each gets its own `currentInjector`
 * global. `inject()` calls cross the boundary and read the wrong
 * one — symptom is `NG0203: The <Token> token injection failed`
 * for tokens that demonstrably exist.
 *
 * The fix pins the SSR pipeline to a single resolution path for
 * every `@angular/*` package — either the bundled vendor file
 * (prod) or Bun's runtime resolution of the bare specifier (dev).
 * That fix is correctness-fragile: a future change that adds a
 * vendor build back, leaves a stale rewrite path, or mixes vendor +
 * bare specifier strategies could silently reintroduce the dual-
 * instance state. The user wouldn't see it until SSR throws NG0203
 * at request time.
 *
 * This module is the build-time check. Walk every server bundle's
 * import statements, extract the resolution shape of every
 * `@angular/core` reference, and verify they're all wire-compatible
 * (all the same canonical path, OR all unresolved bare specifiers
 * that Bun's runtime will collapse to one). Mixed strategies or
 * multiple distinct paths fail the build. */

import { resolve } from 'node:path';
import type { BuildArtifact } from 'bun';
import { logError, logWarn } from '../utils/logger';

/* Match every import-style specifier referencing `@angular/core` in
 * a bundled server output. Captures the full quoted specifier so we
 * can tell apart bare (`@angular/core`) vs vendor (`./vendor/...`)
 * vs absolute-path (`/abs/path/...`) shapes. */
const ANGULAR_CORE_IMPORT_RE =
	/(?:from|import)\s*\(\s*["']([^"']*)["']\s*\)|(?:from|import)\s*["']([^"']*)["']/g;

/* Specifier patterns that indicate `@angular/core` in any of its
 * resolved or unresolved shapes:
 *   - `@angular/core` (bare or path-embedded)
 *   - `angular_core.js` (vendor naming convention from
 *     `buildAngularVendor.ts:toSafeFileName`)
 * Excludes lookalikes like `@angular/core-dep` by anchoring to a
 * trailing `/` or end-of-string. */
const ANGULAR_CORE_PACKAGE_RE =
	/(?:(?:^|\/)@angular\/core(?:\/|$)|(?:^|\/)angular_core\.[mc]?js$)/;

type ImportShape =
	| { kind: 'bare' }
	// Resolved file. Two outputs with the same `canonicalPath` ARE
	// the same instance at runtime.
	| { kind: 'resolved'; canonicalPath: string };

const classifySpecifier = (
	specifier: string,
	artifactPath: string,
	serverOutDir: string | undefined
): ImportShape | null => {
	if (!ANGULAR_CORE_PACKAGE_RE.test(specifier)) return null;

	// Bare bundler specifier (`@angular/core`, `@angular/core/rxjs-interop`)
	// — Bun's runtime resolver dedupes these to one physical
	// installation, so all bare references are the same instance.
	if (specifier.startsWith('@angular/core')) return { kind: 'bare' };

	// Resolved file path (vendor build or transpiler-emitted absolute
	// path). Normalize relative paths against the artifact's location
	// so two outputs in different subdirs that target the same vendor
	// file produce the same canonicalPath.
	let absolute: string;
	if (specifier.startsWith('/')) {
		absolute = specifier;
	} else if (specifier.startsWith('.')) {
		absolute = resolve(artifactPath, '..', specifier);
	} else {
		// Bundler-relative specifier (no leading `.` or `/`) — resolve
		// against the build's root output dir so vendor files emitted
		// by `compileAngular` / `buildAngularVendor` collapse to the
		// same path regardless of which artifact references them.
		absolute = serverOutDir
			? resolve(serverOutDir, specifier)
			: resolve(artifactPath, '..', specifier);
	}
	return {
		kind: 'resolved',
		canonicalPath: absolute.replace(/\\/g, '/')
	};
};

const collectAngularCoreShapes = async (
	artifacts: BuildArtifact[],
	serverOutDir: string | undefined
): Promise<Map<string, Set<string>>> => {
	// shape-key → set of artifact paths that referenced it
	const shapesToArtifacts = new Map<string, Set<string>>();
	for (const artifact of artifacts) {
		let text: string;
		try {
			text = await artifact.text();
		} catch {
			continue;
		}
		ANGULAR_CORE_IMPORT_RE.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = ANGULAR_CORE_IMPORT_RE.exec(text)) !== null) {
			const specifier = match[1] ?? match[2] ?? '';
			if (!specifier) continue;
			const shape = classifySpecifier(specifier, artifact.path, serverOutDir);
			if (!shape) continue;
			const key =
				shape.kind === 'bare' ? 'bare' : `resolved:${shape.canonicalPath}`;
			let set = shapesToArtifacts.get(key);
			if (!set) {
				set = new Set();
				shapesToArtifacts.set(key, set);
			}
			set.add(artifact.path);
		}
	}
	return shapesToArtifacts;
};

export const verifyAngularCoreUniqueness = async (
	artifacts: BuildArtifact[],
	serverOutDir: string | undefined,
	throwOnError: boolean
): Promise<void> => {
	const shapes = await collectAngularCoreShapes(artifacts, serverOutDir);
	if (shapes.size <= 1) return;

	const summary: string[] = [];
	for (const [key, paths] of shapes) {
		const sample = Array.from(paths).slice(0, 3).join('\n     - ');
		const more = paths.size > 3 ? `\n     - … and ${paths.size - 3} more` : '';
		summary.push(`   • ${key} (referenced by ${paths.size} artifact${paths.size === 1 ? '' : 's'}):\n     - ${sample}${more}`);
	}
	const message =
		`Server bundle references ${shapes.size} distinct @angular/core resolutions; ` +
		`every additional one becomes its own runtime module instance with its own ` +
		`\`currentInjector\` global, which is what NG0203 tracks down to.\n` +
		summary.join('\n');

	if (throwOnError) {
		logError(message);
		throw new Error('Angular core multi-instance detected in server bundle');
	}
	logWarn(message);
};
