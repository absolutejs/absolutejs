/* Simple Svelte HMR Implementation
   Lightweight approach: use rebuilt files → re-render → send HTML patch */

import { resolve } from 'node:path';

/* Simple Svelte HMR handler for server-side
   When a Svelte file changes:
   1. The rebuild already compiled Svelte and updated the manifest
   2. Use manifest paths to import the rebuilt server component
   3. Re-render the page
   4. Return the new HTML for patching */
export const handleSvelteUpdate = async (
  svelteFilePath: string,
  manifest: Record<string, string>
) => {
  try {
    const resolvedPath = resolve(svelteFilePath);
    console.log('📦 Handling Svelte update for:', resolvedPath);
    
    // CRITICAL: We should NOT call compileSvelte directly in HMR because:
    // 1. The rebuild that just completed already compiled Svelte
    // 2. compileSvelte outputs to example/svelte/compiled/ (absolute paths)
    // 3. But the build process bundles to example/build/svelte/compiled/ (with hashes)
    // 4. The manifest contains the correct paths to the built files
    // 
    // Instead, we use the manifest paths which point to the built files.
    // The manifest has:
    // - SvelteExample: absolute path to built server bundle
    // - SvelteExampleIndex: relative URL to built client bundle
    
    // Get server path from manifest (absolute path to built server bundle)
    const serverPath = manifest['SvelteExample'];
    
    if (!serverPath) {
      console.warn('⚠️ SvelteExample not found in manifest');
      console.warn('   Available manifest keys:', Object.keys(manifest));
      console.warn('   This might mean the rebuild did not complete or Svelte was not included');

      return null;
    }
    
    console.log('📦 Using Svelte server path from manifest:', serverPath);
    
    // Re-import the server component with cache busting
    // The serverPath is the absolute path to the built server bundle
    const cacheBuster = `?t=${Date.now()}`;
    const serverModule = await import(`${serverPath}${cacheBuster}`);
    
    if (!serverModule || !serverModule.default) {
      console.warn('⚠️ Could not find default export in Svelte server module');

      return null;
    }
    
    console.log('✅ Svelte server module loaded successfully');
    
    // Get indexPath from manifest (relative URL to built client bundle)
    const indexPath = manifest['SvelteExampleIndex'];
    
    if (!indexPath) {
      console.warn('⚠️ SvelteExampleIndex not found in manifest');
      console.warn('   Available manifest keys:', Object.keys(manifest));
      console.warn('   This might mean the rebuild did not complete or Svelte was not included');

      return null;
    }
    
    console.log('📦 Using Svelte indexPath from manifest:', indexPath);
    
    const { handleSveltePageRequest } = await import('../core/pageHandlers');
    
    const response = await handleSveltePageRequest(
      serverModule.default,
      serverPath,
      indexPath,
      {
        cssPath: manifest['SvelteExampleCSS'] || '',
        initialCount: 0
      }
    );
    
    const html = await response.text();
    console.log('📦 Server: Generated HTML length:', html.length);
    
    // Extract just the body content for patching (not the full HTML document)
    // Svelte renders to <body> directly
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
    console.error('❌ Failed to handle Svelte update:', error);

    return null;
  }
}

