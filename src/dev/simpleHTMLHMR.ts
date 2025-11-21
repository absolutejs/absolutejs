/* Simple HTML HMR Implementation
   Lightweight approach: read HTML file → send HTML patch */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/* Simple HTML HMR handler for server-side
   When an HTML file changes:
   1. Read the HTML file
   2. Extract body content (or return full HTML)
   3. Return the HTML for patching */
export const handleHTMLUpdate = async (
  htmlFilePath: string
) => {
  try {
    // The htmlFilePath is already the source path from the file watcher
    // It should be something like: ./example/html/pages/HtmlExample.html
    // But we need to handle both absolute and relative paths
    let sourcePath = htmlFilePath;
    
    // If it's a build path, convert to source path
    if (htmlFilePath.includes('/build/html/')) {
      sourcePath = htmlFilePath.replace('/build/html/', '/html/');
    } else if (htmlFilePath.includes('build/html')) {
      sourcePath = htmlFilePath.replace('build/html', 'html');
    }
    
    const resolvedPath = resolve(sourcePath);
    console.log('📦 Reading HTML file:', resolvedPath);
    
    // Check if file exists
    if (!existsSync(resolvedPath)) {
      console.error(`❌ HTML file not found: ${resolvedPath}`);

      return null;
    }
    
    // Read the HTML file
    const htmlContent = readFileSync(resolvedPath, 'utf-8');
    console.log('📦 HTML file read, length:', htmlContent.length);
    
    // Extract just the body content for patching (not the full HTML document)
    // This makes DOM patching simpler - we only replace the body content
    const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (bodyMatch && bodyMatch[1]) {
      const bodyContent = bodyMatch[1].trim();
      console.log('📦 Server: Extracted body content length:', bodyContent.length);

      return bodyContent;
    }
    
    // Fallback: return full HTML if body extraction fails
    console.warn('⚠️ Server: Body extraction failed, returning full HTML');

    return htmlContent;
  } catch (error) {
    console.error('❌ Failed to handle HTML update:', error);

    return null;
  }
}

