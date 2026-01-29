import { BuildConfig } from '../types';
import { normalizePath } from '../utils/normalizePath';
import type { ResolvedBuildPaths } from './configResolver';

/* Get the directories we should watch based on our config
   This handles the "where to watch" problem */
export const getWatchPaths = (
  config: BuildConfig,
  resolved?: ResolvedBuildPaths
) => {
  const paths: string[] = [];

  // helper to push only when base exists, normalizing for cross-platform compatibility
  const push = (base?: string, sub?: string) => {
    if (!base) return;
    const normalizedBase = normalizePath(base);
    paths.push(sub ? `${normalizedBase}/${sub}` : normalizedBase);
  };

  const cfg = resolved ?? {
    reactDir: config.reactDirectory,
    svelteDir: config.svelteDirectory,
    vueDir: config.vueDirectory,
    angularDir: config.angularDirectory,
    htmlDir: config.htmlDirectory,
    htmxDir: config.htmxDirectory,
    assetsDir: config.assetsDirectory
  };

  // Watch source directories (pages/components/styles etc.)
  push(cfg.reactDir, 'components');
  push(cfg.reactDir, 'pages');
  push(cfg.reactDir, 'styles');

  push(cfg.svelteDir, 'components');
  push(cfg.svelteDir, 'pages');
  push(cfg.svelteDir, 'composables');
  push(cfg.svelteDir, 'styles');

  push(cfg.vueDir, 'components');
  push(cfg.vueDir, 'pages');
  push(cfg.vueDir, 'composables');
  push(cfg.vueDir, 'styles');

  push(cfg.angularDir, 'components');
  push(cfg.angularDir, 'pages');
  push(cfg.angularDir, 'styles');

  push(cfg.htmlDir, 'pages');
  push(cfg.htmlDir, 'scripts');
  push(cfg.htmlDir, 'styles');

  push(cfg.htmxDir, 'pages');
  push(cfg.htmxDir, 'styles');

  push(cfg.assetsDir);
  
  return paths;
}

/* Check if we should ignore a file path
   This handles the "what to ignore" problem */
export const shouldIgnorePath = (path: string) => {
  const normalizedPath = path.replace(/\\/g, '/');
  
  // Be more aggressive with ignoring compiled directories
  return (
    normalizedPath.includes('/build/') ||
    normalizedPath.includes('/compiled/') ||  // This should catch it
    normalizedPath.includes('/indexes/') ||
    normalizedPath.includes('/node_modules/') ||
    normalizedPath.includes('/.git/') ||
    normalizedPath.endsWith('.log') ||
    normalizedPath.endsWith('.tmp') ||
    normalizedPath.startsWith('.') ||
    // Add this to be extra safe
    normalizedPath === 'compiled' ||
    normalizedPath.endsWith('/compiled') ||
    normalizedPath.endsWith('/compiled/')
  );
}

/* Detect which framework a file belongs to based on its path and extension
   This handles the "what framework" problem */
export const detectFramework = (
  filePath: string,
  resolved?: ResolvedBuildPaths
) => {
  // Check if this is an ignored file first
  if (shouldIgnorePath(filePath)) {
    return 'ignored';
  }
  
  const normalized = filePath.replace(/\\/g, '/');

  const startsWithDir = (dir?: string) =>
    dir ? normalized.startsWith(dir.replace(/\\/g, '/')) : false;

  // Prefer resolved directory prefixes when available
  if (resolved) {
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
  if (normalized.endsWith('.tsx') || normalized.endsWith('.jsx')) return 'react';
  if (normalized.endsWith('.svelte')) return 'svelte';
  if (normalized.endsWith('.vue')) return 'vue';
  if (normalized.endsWith('.html')) return 'html';
  if (normalized.endsWith('.ts') && normalized.includes('angular')) return 'angular';
  
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
    if (normalized.includes('/vue/') || normalized.includes('/vue-')) return 'vue';
    if (normalized.includes('/svelte/') || normalized.includes('/svelte-')) return 'svelte';
    if (normalized.includes('/react/') || normalized.includes('/react-')) return 'react';
    if (normalized.includes('/angular/') || normalized.includes('/angular-')) return 'angular';
    if (normalized.includes('/html/') || normalized.includes('/html-')) return 'html';
    if (normalized.includes('/htmx/') || normalized.includes('/htmx-')) return 'htmx';
    // If no framework match, it's a generic asset
    return 'assets';
  }

  return 'unknown';
}