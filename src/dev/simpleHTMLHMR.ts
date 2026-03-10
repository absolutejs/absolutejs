/* Simple HTML HMR Implementation
   Lightweight approach: read HTML file → send HTML patch */

import { resolve } from 'node:path';

/* Simple HTML HMR handler for server-side
   When an HTML file changes:
   1. Read the HTML file
   2. Extract body content (or return full HTML)
   3. Return the HTML for patching */
export const handleHTMLUpdate = async (htmlFilePath: string) => {
	let htmlContent: string;
	try {
		const resolvedPath = resolve(htmlFilePath);
		const file = Bun.file(resolvedPath);
		if (!(await file.exists())) {
			return null;
		}
		htmlContent = await file.text();
	} catch {
		return null;
	}

	const headMatch = htmlContent.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
	const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*)<\/body>/i);

	if (bodyMatch && bodyMatch[1]) {
		return {
			body: bodyMatch[1].trim(),
			head: headMatch && headMatch[1] ? headMatch[1].trim() : null
		};
	}

	return htmlContent;
};
