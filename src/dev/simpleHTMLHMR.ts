/* Simple HTML HMR Implementation
   Lightweight approach: read HTML file → send HTML patch */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/* Simple HTML HMR handler for server-side
   When an HTML file changes:
   1. Read the HTML file
   2. Extract body content (or return full HTML)
   3. Return the HTML for patching */
export const handleHTMLUpdate = async (htmlFilePath: string) => {
	try {
		// The htmlFilePath is now the BUILT file path (e.g., build/html/pages/HTMLExample.html)
		// This ensures we read HTML with updated CSS paths from updateAssetPaths
		const resolvedPath = resolve(htmlFilePath);

		if (!existsSync(resolvedPath)) {
			return null;
		}

		// Read the HTML file
		const htmlContent = readFileSync(resolvedPath, 'utf-8');

		// Extract both head and body content for patching
		// We need head to update CSS links when CSS changes
		const headMatch = htmlContent.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
		const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*)<\/body>/i);

		if (bodyMatch && bodyMatch[1]) {
			const bodyContent = bodyMatch[1].trim();
			const headContent =
				headMatch && headMatch[1] ? headMatch[1].trim() : null;

			// Return object with both head and body for comprehensive updates
			return {
				body: bodyContent,
				head: headContent
			};
		}

		// Fallback: return full HTML if body extraction fails

		return htmlContent;
	} catch {
		return null;
	}
};
