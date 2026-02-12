/* Simple Vue HMR Implementation
   Lightweight approach: use rebuilt files → re-render → send HTML patch */

import { basename, resolve } from 'node:path';
import { toPascal } from '../utils/stringModifiers';

/* Simple Vue HMR handler for server-side
   When a Vue file changes:
   1. The rebuild already compiled Vue and updated the manifest
   2. Derive manifest keys dynamically from the source file path
   3. Use manifest paths to import the rebuilt server component
   4. Re-render the page
   5. Return the new HTML for patching */
export const handleVueUpdate = async (
	vueFilePath: string,
	manifest: Record<string, string>,
	buildDir?: string
) => {
	try {
		const resolvedPath = resolve(vueFilePath);

		// Derive manifest keys dynamically from the source file path
		const fileName = basename(resolvedPath);
		const baseName = fileName.replace(/\.vue$/, '');
		const pascalName = toPascal(baseName);

		// Vue manifest keys follow the pattern:
		// - {PascalName}: server bundle path
		// - {PascalName}Index: client bundle path
		// - {PascalName}CSS: CSS path (optional)
		const componentKey = pascalName;
		const indexKey = `${pascalName}Index`;
		const cssKey = `${pascalName}CSS`;

		// Get server path from manifest (absolute path to built server bundle)
		const serverPath = manifest[componentKey];

		if (!serverPath) {
			return null;
		}

		const cacheBuster = `?t=${Date.now()}`;
		const serverModule = await import(`${serverPath}${cacheBuster}`);

		if (!serverModule || !serverModule.default) {
			return null;
		}

		const indexPath = manifest[indexKey];

		if (!indexPath) {
			return null;
		}

		const { handleVuePageRequest } = await import('../core/pageHandlers');
		const { generateHeadElement } = await import(
			'../utils/generateHeadElement'
		);

		// Create a minimal result object for the handler
		// Use provided buildDir or fall back to process.cwd()/example/build for compatibility
		const resultBuildDir =
			buildDir || resolve(process.cwd(), 'example/build');

		const response = await handleVuePageRequest(
			serverModule.default,
			serverPath,
			indexPath,
			{ manifest, buildDir: resultBuildDir },
			generateHeadElement({
				cssPath: manifest[cssKey] || '',
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
};
