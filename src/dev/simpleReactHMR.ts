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
  manifest: Record<string, string>
) => {
  try {
    // Use fresh module loader to bypass Bun's module cache entirely
    // This ensures we always get the latest source code, even if dependencies changed
    const { loadFreshModule } = await import('./freshModuleLoader');
    const resolvedPath = resolve(componentPath);
    
    console.log('📦 Loading fresh React module:', resolvedPath);
    
    // Load the component using fresh module loader (bypasses cache)
    let ReactModule;
    try {
      ReactModule = await loadFreshModule(resolvedPath);
      console.log('✅ Fresh React module loaded successfully');
      console.log('📦 Module keys:', Object.keys(ReactModule || {}));
    } catch (freshLoadError) {
      console.error('❌ Failed to load fresh module:', freshLoadError);
      // Fallback to regular import with cache busting
      console.log('⚠️ Falling back to regular import with cache busting...');
      const cacheBuster = `?t=${Date.now()}`;
      const relativePath = resolvedPath.includes('/react/pages/')
        ? `../../example/react/pages/ReactExample.tsx${cacheBuster}`
        : `../../${componentPath}${cacheBuster}`;
      ReactModule = await import(relativePath);
      console.log('✅ Fallback import successful');
    }
    
    if (!ReactModule || !ReactModule.ReactExample) {
      console.warn('⚠️ Could not find ReactExample in module');
      console.warn('⚠️ Module keys:', Object.keys(ReactModule || {}));

      return null;
    }
    
    console.log('✅ ReactExample component found in module');

    // Re-render the page
    const indexPath = manifest['ReactExampleIndex'];
    if (!indexPath) {
      console.warn('⚠️ ReactExampleIndex not found in manifest');

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
    console.log('📦 Server: Generated HTML length:', html.length);
    
    // Extract just the body content for patching (not the full HTML document)
    // This makes DOM patching simpler
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (bodyMatch && bodyMatch[1]) {
      const bodyContent = bodyMatch[1].trim();
      console.log('📦 Server: Extracted body content length:', bodyContent.length);

      return bodyContent;
    }
    
    // Fallback: return full HTML if body extraction fails
    console.warn('⚠️ Server: Body extraction failed, returning full HTML');

    return html;
  } catch (error) {
    console.error('❌ Failed to handle React update:', error);

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

