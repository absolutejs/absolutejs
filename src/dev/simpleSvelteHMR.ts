/* Simple Svelte HMR Implementation
   Lightweight approach: use rebuilt files → re-render → send HTML patch */

import { basename, join, resolve } from 'node:path';
import { toPascal } from '../utils/stringModifiers';

/* Simple Svelte HMR handler for server-side
   When a Svelte file changes:
   1. The rebuild already compiled Svelte and updated the manifest
   2. Derive manifest keys dynamically from the source file path
   3. Use manifest paths to import the rebuilt server component
   4. Re-render the page
   5. Return the new HTML for patching */
export const handleSvelteUpdate = async (
  svelteFilePath: string,
  manifest: Record<string, string>,
  buildDir?: string
) => {
  try {
    const resolvedPath = resolve(svelteFilePath);

    // Derive manifest keys dynamically from the source file path
    const fileName = basename(resolvedPath);
    const baseName = fileName.replace(/\.svelte$/, '');
    const pascalName = toPascal(baseName);

    // Svelte manifest keys follow the pattern:
    // - {PascalName}: server bundle path
    // - {PascalName}Index: client bundle path
    // - {PascalName}CSS: CSS path (optional)
    const componentKey = pascalName;
    const indexKey = `${pascalName}Index`;
    const cssKey = `${pascalName}CSS`;

    // Get server path from manifest (URL path like /svelte/compiled/pages/SvelteExample.abc123.js)
    const serverPath = manifest[componentKey];

    if (!serverPath) {
      console.warn('[Svelte HMR] Server path not found in manifest for:', componentKey);
      console.warn('[Svelte HMR] Available manifest keys:', Object.keys(manifest).join(', '));
      return null;
    }

    // Convert URL path to absolute filesystem path
    // Manifest stores paths like "/svelte/compiled/pages/SvelteExample.abc123.js"
    // Need to resolve relative to project build directory
    const projectRoot = buildDir || process.cwd();
    const absoluteServerPath = join(projectRoot, serverPath.replace(/^\//, ''));

    const cacheBuster = `?t=${Date.now()}`;
    const serverModule = await import(`${absoluteServerPath}${cacheBuster}`);

    if (!serverModule || !serverModule.default) {
      console.warn('[Svelte HMR] Module has no default export:', absoluteServerPath);
      return null;
    }

    const indexPath = manifest[indexKey];

    if (!indexPath) {
      console.warn('[Svelte HMR] Index path not found in manifest for:', indexKey);
      return null;
    }

    const { handleSveltePageRequest } = await import('../core/pageHandlers');

    // Create a minimal result object for the handler
    // Use provided buildDir or fall back to process.cwd()/example/build for compatibility
    const resultBuildDir = buildDir || resolve(process.cwd(), 'example/build');

    const response = await handleSveltePageRequest(
      serverModule.default,
      serverPath,
      indexPath,
      { manifest, buildDir: resultBuildDir },
      {
        cssPath: manifest[cssKey] || '',
        initialCount: 0
      }
    );

    const html = await response.text();

    // Extract just the body content for patching (not the full HTML document)
    // Svelte renders to <body> directly
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (bodyMatch && bodyMatch[1]) {
      const bodyContent = bodyMatch[1].trim();

      return bodyContent;
    }

    return html;
  } catch (err) {
    console.error('[Svelte HMR] Error in handleSvelteUpdate:', err);
    return null;
  }
}

