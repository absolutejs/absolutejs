/* Simple React HMR Implementation
   Lightweight approach: rebuild → re-import → re-render → patch DOM */

import { resolve } from 'node:path';

/* Simple React HMR handler for server-side
   When a React file changes:
   1. Clear module from cache (by using fresh module loader)
   2. Re-render the page
   3. Return the new HTML */
export async function handleReactUpdate(
  componentPath: string,
  manifest: Record<string, string>
): Promise<string | null> {
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
   When a React module update is received:
   1. Re-import the module with cache busting
   2. Patch the DOM with new HTML from server */
export function generateSimpleReactHMRClientCode(): string {
  return `
    // Simple React HMR Client Handler
    function handleReactUpdate(update) {
      if (update.framework !== 'react') {
        return false;
      }

      console.log('🔄 React update received:', update.sourceFile);

      // If server sent new HTML, patch the DOM
      if (update.html) {
        const container = document.querySelector('[data-react-component]') || document.body;
        if (container) {
          // Patch the DOM with new HTML
          container.innerHTML = update.html;
          console.log('✅ React component updated via DOM patch');
          return true;
        }
      }

      // If no HTML, try to re-import the module
      if (update.modulePath) {
        const cacheBuster = '?t=' + Date.now();
        const fullPath = update.modulePath.startsWith('/') 
          ? update.modulePath + cacheBuster
          : '/' + update.modulePath + cacheBuster;

        import(/* @vite-ignore */ fullPath)
          .then(() => {
            console.log('✅ React module re-imported');
            // Trigger a re-render by dispatching a custom event
            window.dispatchEvent(new Event('react-hmr-update'));
          })
          .catch((error) => {
            console.error('❌ Failed to re-import React module:', error);
            window.location.reload();
          });

        return true;
      }

      return false;
    }
  `;
}

