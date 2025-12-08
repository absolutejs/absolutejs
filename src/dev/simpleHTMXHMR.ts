/* Simple HTMX HMR Implementation
   Lightweight approach: read HTMX HTML file → send HTML patch */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/* Simple HTMX HMR handler for server-side
   When an HTMX file changes:
   1. Read the HTML file
   2. Extract body content (or return full HTML)
   3. Return the HTML for patching */
export const handleHTMXUpdate = async (
  htmxFilePath: string
) => {
  try {
    let sourcePath = htmxFilePath;

    // If it's a build path, convert to source path
    if (htmxFilePath.includes('/build/htmx/')) {
      sourcePath = htmxFilePath.replace('/build/htmx/', '/htmx/');
    } else if (htmxFilePath.includes('build/htmx')) {
      sourcePath = htmxFilePath.replace('build/htmx', 'htmx');
    }

    const resolvedPath = resolve(sourcePath);

    if (!existsSync(resolvedPath)) {
      console.error(`❌ HTMX file not found: ${resolvedPath}`);

      return null;
    }

    const htmlContent = readFileSync(resolvedPath, 'utf-8');

    const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (bodyMatch && bodyMatch[1]) {
      const bodyContent = bodyMatch[1].trim();

      return bodyContent;
    }

    console.warn('⚠️ Server: HTMX body extraction failed, returning full HTML');

    return htmlContent;
  } catch (error) {
    console.error('❌ Failed to handle HTMX update:', error);

    return null;
  }
}

