import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
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

	// User-supplied extra dirs from absolute.config.ts → dev.watchDirs.
	const extraDirs = config.dev?.watchDirs ?? [];
	for (const dir of extraDirs) push(dir);

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
