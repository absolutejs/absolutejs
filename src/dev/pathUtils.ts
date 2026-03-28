import { readdirSync } from 'node:fs';
import { BuildConfig } from '../../types/build';
import { commonAncestor } from '../utils/commonAncestor';
import { normalizePath } from '../utils/normalizePath';
import type { ResolvedBuildPaths } from './configResolver';

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
		if (startsWithDir(resolved.htmlDir)) return 'html';
		if (startsWithDir(resolved.assetsDir)) return 'assets';
	} else {
		// Fallback heuristics when resolved paths are not provided
		if (normalized.includes('/htmx/')) return 'htmx';
		if (normalized.includes('/react/')) return 'react';
		if (normalized.includes('/svelte/')) return 'svelte';
		if (normalized.includes('/vue/')) return 'vue';
		if (normalized.includes('/angular/')) return 'angular';
		if (normalized.includes('/html/')) return 'html';
	}

	// Then check file extensions for files not in framework directories
	if (normalized.endsWith('.tsx') || normalized.endsWith('.jsx'))
		return 'react';
	if (normalized.endsWith('.svelte')) return 'svelte';
	if (normalized.endsWith('.vue')) return 'vue';
	if (normalized.endsWith('.html')) return 'html';
	if (normalized.endsWith('.ts') && normalized.includes('angular'))
		return 'angular';

	// Generic assets (CSS in root /assets/, images, etc.)
	// IMPORTANT: Only return 'assets' for CSS files that are NOT in framework directories
	// CSS files in framework directories (like /vue/styles/ or /svelte/styles/) should have
	// been caught by the framework checks above. If we reach here with a .css file, it means
	// the file wasn't in a framework directory, so it's a true asset.
	if (normalized.includes('/assets/')) return 'assets';

	// For CSS files not caught by framework directory checks, check one more time
	// using path segment matching (handles cases where resolved paths might not match exactly)
	if (normalized.endsWith('.css')) {
		// Check if this CSS is in a framework styles directory by looking for common patterns
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

		// If no framework match, it's a generic asset
		return 'assets';
	}

	return 'unknown';
};
const getSiblingDirs = (
	frameworkDirs: string[],
	cfg: { assetsDir?: string; stylesDir?: string }
) => {
	if (frameworkDirs.length === 0) return [];

	const root = commonAncestor(frameworkDirs);
	if (!root) return [];

	const knownNames = new Set(
		[...frameworkDirs, cfg.assetsDir, cfg.stylesDir]
			.filter((dir): dir is string => Boolean(dir))
			.map((dir) => normalizePath(dir).split('/').pop())
	);
	knownNames.add('build');
	knownNames.add('node_modules');
	knownNames.add('.absolutejs');

	try {
		return readdirSync(root, { withFileTypes: true })
			.filter(
				(entry) => entry.isDirectory() && !knownNames.has(entry.name)
			)
			.map((entry) => `${root}/${entry.name}`);
	} catch {
		// root may not exist yet
		return [];
	}
};

export const getWatchPaths = (
	config: BuildConfig,
	resolved?: ResolvedBuildPaths
) => {
	const paths: string[] = [];

	const push = (base?: string, sub?: string) => {
		if (!base) return;
		const normalizedBase = normalizePath(base);
		paths.push(sub ? `${normalizedBase}/${sub}` : normalizedBase);
	};

	const cfg = resolved ?? {
		angularDir: config.angularDirectory,
		assetsDir: config.assetsDirectory,
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

	// Watch entire framework directories. Intermediate build files live
	// under .absolutejs/generated/ which is already excluded from watching.
	push(cfg.reactDir);
	push(cfg.svelteDir);
	push(cfg.vueDir);

	push(cfg.angularDir);

	push(cfg.htmlDir, 'pages');
	push(cfg.htmlDir, 'scripts');
	push(cfg.htmlDir, 'styles');

	push(cfg.htmxDir, 'pages');
	push(cfg.htmxDir, 'scripts');
	push(cfg.htmxDir, 'styles');

	push(cfg.assetsDir);
	push(cfg.stylesDir);

	// Also watch sibling directories under the common parent of all
	// configured dirs — these contain shared files (workers, utils, etc.)
	// that may be referenced by multiple frameworks.
	const frameworkDirs = [
		cfg.reactDir,
		cfg.svelteDir,
		cfg.vueDir,
		cfg.angularDir,
		cfg.htmlDir,
		cfg.htmxDir
	]
		.filter((dir): dir is string => Boolean(dir))
		.map(normalizePath);

	for (const siblingPath of getSiblingDirs(frameworkDirs, cfg)) {
		push(siblingPath);
	}

	return paths;
};
export const shouldIgnorePath = (
	path: string,
	resolved?: ResolvedBuildPaths
) => {
	const normalizedPath = path.replace(/\\/g, '/');

	// Allow files inside the configured styles directory through
	if (resolved?.stylesDir && normalizedPath.startsWith(resolved.stylesDir)) {
		return false;
	}

	// Ignore build output and framework-managed directories
	return (
		normalizedPath.includes('/build/') ||
		normalizedPath.includes('/generated/') ||
		normalizedPath.includes('/.absolutejs/') ||
		normalizedPath.includes('/node_modules/') ||
		normalizedPath.includes('/.git/') ||
		normalizedPath.endsWith('.log') ||
		normalizedPath.endsWith('.tmp') ||
		normalizedPath.startsWith('.')
	);
};
