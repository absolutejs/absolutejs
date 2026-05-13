import { type Dirent, existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { BuildConfig } from '../../types/build';
import { normalizePath } from '../utils/normalizePath';
import type { ResolvedBuildPaths } from './configResolver';

const STYLE_EXTENSION_PATTERN = /\.(css|s[ac]ss|less|styl(?:us)?)$/i;

/* Get the directories we should watch based on our config
   This handles the "where to watch" problem */
export const detectFramework = (
	filePath: string,
	resolved?: ResolvedBuildPaths
) => {
	// Check if this is an ignored file first
	if (shouldIgnorePath(filePath, resolved)) {
		return 'ignored';
	}

	const normalized = filePath.replace(/\\/g, '/');

	const startsWithDir = (dir?: string) =>
		dir ? normalized.startsWith(dir.replace(/\\/g, '/')) : false;

	// Prefer resolved directory prefixes when available
	if (resolved) {
		if (startsWithDir(resolved.stylesDir)) return 'styles';
		if (startsWithDir(resolved.htmxDir)) return 'htmx';
		if (startsWithDir(resolved.reactDir)) return 'react';
		if (startsWithDir(resolved.svelteDir)) return 'svelte';
		if (startsWithDir(resolved.vueDir)) return 'vue';
		if (startsWithDir(resolved.angularDir)) return 'angular';
		if (startsWithDir(resolved.emberDir)) return 'ember';
		if (startsWithDir(resolved.htmlDir)) return 'html';
		if (startsWithDir(resolved.assetsDir)) return 'assets';
	} else {
		// Fallback heuristics when resolved paths are not provided
		if (normalized.includes('/htmx/')) return 'htmx';
		if (normalized.includes('/react/')) return 'react';
		if (normalized.includes('/svelte/')) return 'svelte';
		if (normalized.includes('/vue/')) return 'vue';
		if (normalized.includes('/angular/')) return 'angular';
		if (normalized.includes('/ember/')) return 'ember';
		if (normalized.includes('/html/')) return 'html';
	}

	// Then check file extensions for files not in framework directories
	if (normalized.endsWith('.tsx') || normalized.endsWith('.jsx'))
		return 'react';
	if (normalized.endsWith('.svelte')) return 'svelte';
	if (normalized.endsWith('.vue')) return 'vue';
	if (normalized.endsWith('.gjs') || normalized.endsWith('.gts'))
		return 'ember';
	if (normalized.endsWith('.html')) return 'html';
	if (normalized.endsWith('.ts') && normalized.includes('angular'))
		return 'angular';
	if (normalized.endsWith('.ts') && normalized.includes('ember'))
		return 'ember';

	// Generic assets (styles in root /assets/, images, etc.)
	if (normalized.includes('/assets/')) return 'assets';

	// For style files not caught by framework directory checks, check one more time
	if (STYLE_EXTENSION_PATTERN.test(normalized)) {
		if (normalized.includes('/vue/') || normalized.includes('/vue-'))
			return 'vue';
		if (normalized.includes('/svelte/') || normalized.includes('/svelte-'))
			return 'svelte';
		if (normalized.includes('/react/') || normalized.includes('/react-'))
			return 'react';
		if (
			normalized.includes('/angular/') ||
			normalized.includes('/angular-')
		)
			return 'angular';
		if (normalized.includes('/html/') || normalized.includes('/html-'))
			return 'html';
		if (normalized.includes('/htmx/') || normalized.includes('/htmx-'))
			return 'htmx';

		return 'assets';
	}

	return 'unknown';
};

/** Resolve every directory the watcher is allowed to walk into. The
 *  returned set is an absolute, normalized include-list — anything
 *  outside it is implicitly ignored. This replaces the old approach
 *  of listing the *whole* project root and filtering with an exclude
 *  pattern, which silently caught (and re-built on) files inside
 *  framework-managed paths like `<frameworkDir>/generated/`,
 *  `.absolutejs/`, and the build directory. */
/* Walk `<angularDir>/**` for `*.component.ts` files and return the
 * unique parent directories of any `templateUrl` / `styleUrl` /
 * `styleUrls` reference that resolves OUTSIDE `angularDir`.
 *
 * Without this, components like
 *   `@Component({ styleUrl: '../../styles/foo.css', ... })`
 * never get re-bundled on CSS edits because the CSS file lives at
 * `example/styles/` but the watcher's positive roots are
 * `example/angular/` (recursive) + `<stylesConfig>` (scoped to
 * global stylesheet indexes, NOT per-component CSS). The dep graph
 * already records the styleUrl link, so the rebuild trigger does
 * fire correctly once the watcher reports the event — the gap is
 * purely "is this dir watched?".
 *
 * Cheap to do once at startup: a small angular project has <100
 * `.component.ts` files, each ~1ms to read+regex-scan. */
const collectAngularResourceDirs = (angularDir: string): string[] => {
	const out = new Set<string>();
	const angularRoot = resolve(angularDir);
	const angularRootNormalized = normalizePath(angularRoot);

	const walk = (dir: string) => {
		let entries: Dirent[];
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.name.startsWith('.') || entry.name === 'node_modules') {
				continue;
			}
			const full = resolve(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full);
				continue;
			}
			if (!entry.isFile() || !entry.name.endsWith('.component.ts')) {
				continue;
			}

			let source: string;
			try {
				source = readFileSync(full, 'utf8');
			} catch {
				continue;
			}

			const refs: string[] = [];
			const tplRe = /templateUrl\s*:\s*['"]([^'"]+)['"]/g;
			const styleRe = /styleUrl\s*:\s*['"]([^'"]+)['"]/g;
			const stylesArrRe = /styleUrls\s*:\s*\[([^\]]*)\]/g;
			const literalRe = /['"]([^'"]+)['"]/g;
			let match: RegExpExecArray | null;
			while ((match = tplRe.exec(source)) !== null) {
				if (match[1]) refs.push(match[1]);
			}
			while ((match = styleRe.exec(source)) !== null) {
				if (match[1]) refs.push(match[1]);
			}
			while ((match = stylesArrRe.exec(source)) !== null) {
				const inner = match[1];
				if (!inner) continue;
				let strMatch: RegExpExecArray | null;
				const innerRe = new RegExp(literalRe.source, literalRe.flags);
				while ((strMatch = innerRe.exec(inner)) !== null) {
					if (strMatch[1]) refs.push(strMatch[1]);
				}
			}

			const componentDir = dirname(full);
			for (const ref of refs) {
				const refAbs = normalizePath(resolve(componentDir, ref));
				const refDir = normalizePath(dirname(refAbs));
				// Skip if already under angularDir (recursive watch covers it).
				if (
					refDir === angularRootNormalized ||
					refDir.startsWith(angularRootNormalized + '/')
				) {
					continue;
				}
				out.add(refDir);
			}
		}
	};

	walk(angularRoot);

	return Array.from(out);
};

const collectPositiveWatchRoots = (
	config: BuildConfig,
	resolved?: ResolvedBuildPaths
) => {
	const cwd = process.cwd();
	const roots: string[] = [];
	const push = (path: string | undefined) => {
		if (!path) return;
		const abs = normalizePath(resolve(cwd, path));
		if (!roots.includes(abs)) roots.push(abs);
	};

	const cfg = resolved ?? {
		angularDir: config.angularDirectory,
		assetsDir: config.assetsDirectory,
		emberDir: config.emberDirectory,
		htmlDir: config.htmlDirectory,
		htmxDir: config.htmxDirectory,
		reactDir: config.reactDirectory,
		stylesDir:
			typeof config.stylesConfig === 'string'
				? config.stylesConfig
				: config.stylesConfig?.path,
		svelteDir: config.svelteDirectory,
		vueDir: config.vueDirectory
	};

	// Configured framework directories.
	push(cfg.reactDir);
	push(cfg.svelteDir);
	push(cfg.vueDir);
	push(cfg.emberDir);
	push(cfg.angularDir);
	push(cfg.htmlDir);
	push(cfg.htmxDir);
	push(cfg.assetsDir);
	push(cfg.stylesDir);

	// Common shared-source directories. We only include them when they
	// actually exist on disk so missing dirs don't pollute the watcher
	// or short-circuit shouldIgnorePath checks. These are the canonical
	// places framework-agnostic source lives in real projects.
	for (const candidate of ['src', 'db', 'assets', 'styles']) {
		const abs = normalizePath(resolve(cwd, candidate));
		if (existsSync(abs) && !roots.includes(abs)) roots.push(abs);
	}

	// Cover the rest: any other directory at the project root that
	// isn't ignored. This catches helpers under `utils/`, `lib/`,
	// `shared/`, `config/`, `core/`, or any other non-canonical name
	// the user picked, without hardcoding a list. `shouldIgnorePath`
	// already gates against `node_modules`, `build`, `.absolutejs`,
	// `.git`, etc.; we additionally skip dot-directories and the
	// already-included framework roots.
	try {
		const { readdirSync } = require('node:fs') as typeof import('node:fs');
		const entries = readdirSync(cwd, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			if (entry.name.startsWith('.')) continue;
			const abs = normalizePath(resolve(cwd, entry.name));
			if (roots.includes(abs)) continue;
			if (shouldIgnorePath(abs, resolved)) continue;
			roots.push(abs);
		}
	} catch {
		// Best-effort — fall back to the canonical list above if
		// the project root isn't readable for some reason.
	}

	// User-supplied extra dirs from absolute.config.ts → dev.watchDirs.
	const extraDirs = config.dev?.watchDirs ?? [];
	for (const dir of extraDirs) push(dir);

	// Angular component resource dirs (templateUrl / styleUrl pointing
	// outside angularDir). See `collectAngularResourceDirs` above.
	if (cfg.angularDir) {
		const resourceDirs = collectAngularResourceDirs(cfg.angularDir);
		for (const dir of resourceDirs) {
			if (!roots.includes(dir)) roots.push(dir);
		}
	}

	return roots;
};

export const getWatchPaths = (
	config: BuildConfig,
	resolved?: ResolvedBuildPaths
) => {
	const roots = collectPositiveWatchRoots(config, resolved);
	const paths: string[] = [];
	const push = (base: string | undefined, sub?: string) => {
		if (!base) return;
		const normalizedBase = normalizePath(base);
		paths.push(sub ? `${normalizedBase}/${sub}` : normalizedBase);
	};

	const cfg = resolved ?? {
		htmlDir: config.htmlDirectory,
		htmxDir: config.htmxDirectory
	};

	// HTML/HTMX dirs traditionally watch only specific subpaths to avoid
	// noise from co-located fixtures. Preserve that behavior.
	if (cfg.htmlDir) {
		push(cfg.htmlDir, 'pages');
		push(cfg.htmlDir, 'scripts');
		push(cfg.htmlDir, 'styles');
	}
	if (cfg.htmxDir) {
		push(cfg.htmxDir, 'pages');
		push(cfg.htmxDir, 'scripts');
		push(cfg.htmxDir, 'styles');
	}

	// Everything else: watch the directory itself. shouldIgnorePath
	// guards against any framework-managed children (build/, generated/,
	// .absolutejs/, etc).
	for (const root of roots) {
		if (root === normalizePath(cfg.htmlDir ?? '')) continue;
		if (root === normalizePath(cfg.htmxDir ?? '')) continue;
		paths.push(root);
	}

	return paths;
};

/** Hard-deny segments that ALWAYS get ignored, even inside a watched
 *  positive root. These are the build/output paths that AbsoluteJS
 *  itself writes into — feeding their events back into the watcher
 *  causes the rebuild thrash. */
const HARD_DENY_PATTERN =
	/(^|\/)(build|generated|compiled|indexes|\.absolutejs|node_modules|\.git|\.test-builds|dist)(\/|$)/;

/** A path is ignored when it is NOT inside any of the configured
 *  positive watch roots, OR when it falls inside a hard-denied
 *  build/output subtree. The styles directory is always allowed. */
export const shouldIgnorePath = (
	path: string,
	resolved?: ResolvedBuildPaths
) => {
	const normalized = path.replace(/\\/g, '/');

	if (resolved?.stylesDir) {
		const styles = normalized.startsWith(
			resolved.stylesDir.replace(/\\/g, '/')
		);
		if (styles) return false;
	}

	if (HARD_DENY_PATTERN.test(normalized)) return true;
	if (normalized.endsWith('.log')) return true;
	if (normalized.endsWith('.tmp')) return true;
	if (normalized.endsWith('~')) return true;

	return false;
};
