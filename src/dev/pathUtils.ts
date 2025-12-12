import { BuildConfig } from '../types';

/* Get the directories we should watch based on our config
   This handles the "where to watch" problem */
export const getWatchPaths = (config: BuildConfig) => {
  const paths: string[] = [];
  
  // Watch only specific source directories, not the entire directory
  // This prevents watching compiled/build directories that cause infinite loops
  
  if (config.reactDirectory) {
    // Watch React source directories only
    paths.push(`${config.reactDirectory}/components`);
    paths.push(`${config.reactDirectory}/pages`);
    paths.push(`${config.reactDirectory}/styles`);
    // Don't watch the root reactDirectory to avoid compiled/indexes
  }
  
  if (config.svelteDirectory) {
    // Watch Svelte source directories only
    paths.push(`${config.svelteDirectory}/components`);
    paths.push(`${config.svelteDirectory}/pages`);
    paths.push(`${config.svelteDirectory}/composables`);
    paths.push(`${config.svelteDirectory}/styles`);
  }
  
  if (config.vueDirectory) {
    // Watch Vue source directories only
    paths.push(`${config.vueDirectory}/components`);
    paths.push(`${config.vueDirectory}/pages`);
    paths.push(`${config.vueDirectory}/composables`);
    paths.push(`${config.vueDirectory}/styles`);
  }
  
  if (config.angularDirectory) {
    // Watch Angular source directories only
    paths.push(`${config.angularDirectory}/components`);
    paths.push(`${config.angularDirectory}/pages`);
    paths.push(`${config.angularDirectory}/styles`);
  }
  
  if (config.htmlDirectory) {
    // Watch HTML source directories
    paths.push(`${config.htmlDirectory}/pages`);
    paths.push(`${config.htmlDirectory}/scripts`);
    paths.push(`${config.htmlDirectory}/styles`);
  }
  
  if (config.htmxDirectory) {
    // Watch HTMX source directories
    paths.push(`${config.htmxDirectory}/pages`);
    paths.push(`${config.htmxDirectory}/styles`);
  }
  
  if (config.assetsDirectory) {
    // Watch assets directory for CSS, images, etc.
    paths.push(config.assetsDirectory);
  }
  
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
export const detectFramework = (filePath: string) => {
  // Check if this is an ignored file first
  if (shouldIgnorePath(filePath)) {
    return 'ignored';
  }
  
  // IMPORTANT: Check framework-specific paths FIRST (before generic extensions)
  // This ensures CSS files in framework directories trigger HMR for that framework
  // Example: /html/styles/html-example.css should be detected as 'html', not 'assets'
  
  if (filePath.includes('/htmx/')) {
    return 'htmx';
  }
  if (filePath.includes('/react/')) {
    return 'react';
  }
  if (filePath.includes('/svelte/')) {
    return 'svelte';
  }
  if (filePath.includes('/vue/')) {
    return 'vue';
  }
  if (filePath.includes('/angular/')) {
    return 'angular';
  }
  if (filePath.includes('/html/')) {
    return 'html';
  }
  
  // Then check file extensions for files not in framework directories
  if (filePath.endsWith('.tsx') || filePath.endsWith('.jsx')) {
    return 'react';
  }
  if (filePath.endsWith('.svelte')) {
    return 'svelte';
  }
  if (filePath.endsWith('.vue')) {
    return 'vue';
  }
  if (filePath.endsWith('.html')) {
    return 'html';
  }
  if (filePath.endsWith('.ts') && filePath.includes('angular')) {
    return 'angular';
  }
  
  // Generic assets (CSS in root /assets/, images, etc.)
  if (filePath.includes('/assets/') || filePath.endsWith('.css')) {
    return 'assets';
  }

  return 'unknown';
}