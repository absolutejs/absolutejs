import { BuildConfig } from '../types';

/* Get the directories we should watch based on our config
   This handles the "where to watch" problem */
export function getWatchPaths(config: BuildConfig): string[] {
  const paths: string[] = [];
  
  // Watch only specific source directories, not the entire directory
  // This prevents watching compiled/build directories that cause infinite loops
  
  if (config.reactDirectory) {
    // Watch React source directories only
    paths.push(`${config.reactDirectory}/components`);
    paths.push(`${config.reactDirectory}/pages`);
    // Don't watch the root reactDirectory to avoid compiled/indexes
  }
  
  if (config.svelteDirectory) {
    // Watch Svelte source directories only
    paths.push(`${config.svelteDirectory}/components`);
    paths.push(`${config.svelteDirectory}/pages`);
    paths.push(`${config.svelteDirectory}/composables`);
  }
  
  if (config.vueDirectory) {
    // Watch Vue source directories only
    paths.push(`${config.vueDirectory}/components`);
    paths.push(`${config.vueDirectory}/pages`);
    paths.push(`${config.vueDirectory}/composables`);
  }
  
  if (config.angularDirectory) {
    // Watch Angular source directories only
    paths.push(`${config.angularDirectory}/components`);
    paths.push(`${config.angularDirectory}/pages`);
  }
  
  if (config.htmlDirectory) {
    // Watch HTML source directories
    paths.push(`${config.htmlDirectory}/pages`);
    paths.push(`${config.htmlDirectory}/scripts`);
  }
  
  if (config.htmxDirectory) {
    // Watch HTMX source directories
    paths.push(`${config.htmxDirectory}/pages`);
  }
  
  if (config.assetsDirectory) {
    // Watch assets directory for CSS, images, etc.
    paths.push(config.assetsDirectory);
  }
  
  return paths;
}

/* Check if we should ignore a file path
   This handles the "what to ignore" problem */
export function shouldIgnorePath(path: string): boolean {
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
export function detectFramework(filePath: string): string {
  // Check if this is an ignored file first
  if (shouldIgnorePath(filePath)) {
    return 'ignored';
  }
  
  if (filePath.includes('/htmx/')) {
    return 'htmx';
  }
  if (filePath.includes('/react/') || filePath.endsWith('.tsx') || filePath.endsWith('.jsx')) {
    return 'react';
  }
  if (filePath.includes('/svelte/') || filePath.endsWith('.svelte')) {
    return 'svelte';
  }
  if (filePath.includes('/vue/') || filePath.endsWith('.vue')) {
    return 'vue';
  }
  if (filePath.includes('/angular/') || (filePath.endsWith('.ts') && filePath.includes('angular'))) {
    return 'angular';
  }
  if (filePath.includes('/html/') || filePath.endsWith('.html')) {
    return 'html';
  }
  if (filePath.includes('/assets/') || filePath.endsWith('.css')) {
    return 'assets';
  }
  return 'unknown';
}