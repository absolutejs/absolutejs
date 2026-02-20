/* Simple Angular HMR Implementation
   Lightweight approach: use rebuilt files → re-render → send HTML patch */

import { basename, resolve } from 'node:path';
import { toPascal } from '../utils/stringModifiers';

/* Simple Angular HMR handler for server-side
   When an Angular file changes:
   1. The rebuild already compiled Angular and updated the manifest
   2. Derive manifest keys dynamically from the source file path
   3. Use manifest paths to call handleAngularPageRequest (which does its own import)
   4. Re-render the page
   5. Return the new HTML for patching */
export const handleAngularUpdate = async (
	angularFilePath: string,
	manifest: Record<string, string>,
	buildDir?: string
) => {
	try {
		const resolvedPath = resolve(angularFilePath);

		// Derive manifest keys dynamically from the source file path
		const fileName = basename(resolvedPath);
		const baseName = fileName.replace(/\.[tj]s$/, '');
		const pascalName = toPascal(baseName);

		// Angular manifest keys follow the pattern:
		// - {PascalName}: server bundle path
		// - {PascalName}Index: client bundle path
		// - {PascalName}CSS: CSS path (optional)
		const componentKey = pascalName;
		const indexKey = `${pascalName}Index`;
		const cssKey = `${pascalName}CSS`;

		// Get server path from manifest
		const serverPath = manifest[componentKey];

		if (!serverPath) {
			console.warn(
				'[Angular HMR] Server path not found in manifest for:',
				componentKey
			);
			console.warn(
				'[Angular HMR] Available manifest keys:',
				Object.keys(manifest).join(', ')
			);
			return null;
		}

		const indexPath = manifest[indexKey];

		if (!indexPath) {
			console.warn(
				'[Angular HMR] Index path not found in manifest for:',
				indexKey
			);
			return null;
		}

		// Angular's handleAngularPageRequest does its own import() internally,
		// so we pass the server path string with a cache-buster (not the imported module)
		const cacheBuster = `?t=${Date.now()}`;
		const serverPathWithCacheBuster = `${serverPath}${cacheBuster}`;

		const { handleAngularPageRequest } = await import(
			'../core/pageHandlers'
		);
		const { generateHeadElement } = await import(
			'../utils/generateHeadElement'
		);

		const response = await handleAngularPageRequest(
			serverPathWithCacheBuster,
			indexPath,
			generateHeadElement({
				cssPath: manifest[cssKey] || '',
				title: 'AbsoluteJS + Angular'
			}),
			{ initialCount: 0 }
		);

		if (response.status !== 200) {
			console.warn(
				'[Angular HMR] SSR returned status',
				response.status,
				'— falling back to reload'
			);

			return null;
		}

		const html = await response.text();

		// Extract just the body content for patching (not the full HTML document)
		const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
		if (bodyMatch && bodyMatch[1]) {
			const bodyContent = bodyMatch[1].trim();

			return bodyContent;
		}

		return html;
	} catch (err) {
		console.error('[Angular HMR] Error in handleAngularUpdate:', err);
		return null;
	}
};
