/* Simple React HMR Implementation
   Lightweight approach: rebuild → re-import → re-render → patch DOM */

import { resolve } from 'node:path';

/* Simple React HMR handler for server-side
   When a React file changes:
   1. Clear module from cache (by using fresh module loader)
   2. Re-render the page
   3. Return the new HTML */
export const handleReactUpdate = async (
  componentPath: string,
  manifest: Record<string, string>,
  reactDirectory: string
) => {
  try {
    // Use fresh module loader to bypass Bun's module cache entirely
    // This ensures we always get the latest source code, even if dependencies changed
    const { loadFreshModule } = await import('./freshModuleLoader');
    const resolvedPath = resolve(componentPath);
    
    // Load the component using fresh module loader (bypasses cache)
    let ReactModule;
    try {
      ReactModule = await loadFreshModule(resolvedPath);
    } catch {
      const cacheBuster = `?t=${Date.now()}`;
      const relativePath = `../../${componentPath}${cacheBuster}`;
      ReactModule = await import(relativePath);
    }
    
    if (!ReactModule || !ReactModule.ReactExample) {
      return null;
    }

    const indexPath = manifest['ReactExampleIndex'];
    if (!indexPath) {
      return null;
    }

    const { handleReactPageRequest } = await import('../core/pageHandlers');
    
    const response = await handleReactPageRequest(
      ReactModule.ReactExample,
      indexPath,
      {
        cssPath: manifest['ReactExampleCSS'] || '',
        initialCount: 0
      }
    );

    const html = await response.text();
    
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (bodyMatch && bodyMatch[1]) {
      return bodyMatch[1].trim();
    }
    
    return html;
  } catch {
    return null;
  }
}

/* Simple React HMR handler for client-side
   NOTE: This function is currently unused - React HMR is handled directly
   in the react-update message handler in hmrServer.ts. Keeping the export
   for potential future use or removal if confirmed unnecessary. */
export function generateSimpleReactHMRClientCode(): string {
  // React HMR is handled directly in the react-update case in hmrServer.ts
  // No client-side code generation needed at this time
  return '';
}

