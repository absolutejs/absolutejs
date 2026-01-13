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
    const resolvedPath = resolve(htmxFilePath);

    if (!existsSync(resolvedPath)) {
      return null;
    }

    const htmlContent = readFileSync(resolvedPath, 'utf-8');

    // Extract both head and body content for patching
    // We need head to update CSS links when CSS changes
    const headMatch = htmlContent.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
    const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    
    if (bodyMatch && bodyMatch[1]) {
      const bodyContent = bodyMatch[1].trim();
      const headContent = headMatch && headMatch[1] ? headMatch[1].trim() : null;
      if (headContent) {
      }

      // Return object with both head and body for comprehensive updates
      return {
        body: bodyContent,
        head: headContent
      };
    }


    return htmlContent;
  } catch {
    return null;
  }
};
