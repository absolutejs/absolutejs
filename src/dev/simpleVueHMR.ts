/* Simple Vue HMR Implementation
   Lightweight approach: use rebuilt files → re-render → send HTML patch */

import { resolve } from 'node:path';

/* Simple Vue HMR handler for server-side
   When a Vue file changes:
   1. The rebuild already compiled Vue and updated the manifest
   2. Use manifest paths to import the rebuilt server component
   3. Re-render the page
   4. Return the new HTML for patching */
export const handleVueUpdate = async (
  vueFilePath: string,
  manifest: Record<string, string>
) => {
  try {
    const resolvedPath = resolve(vueFilePath);
    
    // CRITICAL: We should NOT call compileVue directly in HMR because:
    // 1. The rebuild that just completed already compiled Vue
    // 2. compileVue outputs to example/vue/compiled/ (absolute paths)
    // 3. But the build process bundles to example/build/vue/compiled/ (with hashes)
    // 4. The manifest contains the correct paths to the built files
    // 
    // Instead, we use the manifest paths which point to the built files.
    // The manifest has:
    // - VueExample: absolute path to built server bundle
    // - VueExampleIndex: relative URL to built client bundle
    
    // Get server path from manifest (absolute path to built server bundle)
    const serverPath = manifest['VueExample'];
    
    if (!serverPath) {
      return null;
    }
    
    const cacheBuster = `?t=${Date.now()}`;
    const serverModule = await import(`${serverPath}${cacheBuster}`);
    
    if (!serverModule || !serverModule.default) {
      return null;
    }
    
    const indexPath = manifest['VueExampleIndex'];
    
    if (!indexPath) {
      return null;
    }
    
    const { handleVuePageRequest } = await import('../core/pageHandlers');
    const { generateHeadElement } = await import('../utils/generateHeadElement');
    
    const response = await handleVuePageRequest(
      serverModule.default,
      serverPath,
      indexPath,
      generateHeadElement({
        cssPath: manifest['VueExampleCSS'] || '',
        title: 'AbsoluteJS + Vue'
      }),
      { initialCount: 0 }
    );
    
    const html = await response.text();
    
    // Extract just the body content for patching (not the full HTML document)
    // Vue renders to <div id="root"> inside <body>
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
