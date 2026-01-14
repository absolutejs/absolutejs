/* Simple Svelte HMR Implementation
   Lightweight approach: use rebuilt files → re-render → send HTML patch */

import { basename, resolve } from 'node:path';
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
  manifest: Record<string, string>
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

    // Get server path from manifest (absolute path to built server bundle)
    const serverPath = manifest[componentKey];

    if (!serverPath) {
      return null;
    }

    const cacheBuster = `?t=${Date.now()}`;
    const serverModule = await import(`${serverPath}${cacheBuster}`);

    if (!serverModule || !serverModule.default) {
      return null;
    }

    const indexPath = manifest[indexKey];

    if (!indexPath) {
      return null;
    }

    const { handleSveltePageRequest } = await import('../core/pageHandlers');

    const response = await handleSveltePageRequest(
      serverModule.default,
      serverPath,
      indexPath,
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
  } catch {
    return null;
  }
}

