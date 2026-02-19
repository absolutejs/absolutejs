/* Simple Vue HMR Implementation
   Lightweight approach: use rebuilt files → re-render → send HTML patch */

import { basename, join, resolve } from 'node:path';
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

		// Get server path from manifest (URL path like /vue/compiled/pages/VueExample.abc123.js)
		const serverPath = manifest[componentKey];

		if (!serverPath) {
			console.warn(
				'[Vue HMR] Server path not found in manifest for:',
				componentKey
			);
			console.warn(
				'[Vue HMR] Available manifest keys:',
				Object.keys(manifest).join(', ')
			);
			return null;
		}

		// Manifest stores absolute paths for Vue server bundles (artifact.path)
		// Use directly if absolute; otherwise join with buildDir for relative paths
		const absoluteServerPath =
			resolve(serverPath) === serverPath ||
			serverPath.startsWith('/') ||
			/^[A-Za-z]:[\\/]/.test(serverPath)
				? serverPath
				: join(
						buildDir || process.cwd(),
						serverPath.replace(/^\//, '')
					);

		const cacheBuster = `?t=${Date.now()}`;
		const serverModule = await import(
			`${absoluteServerPath}${cacheBuster}`
		);

		if (!serverModule || !serverModule.default) {
			console.warn(
				'[Vue HMR] Module has no default export:',
				absoluteServerPath
			);
			return null;
		}

		const indexPath = manifest[indexKey];

		if (!indexPath) {
			console.warn(
				'[Vue HMR] Index path not found in manifest for:',
				indexKey
			);
			return null;
		}

		const { handleVuePageRequest } = await import('../vue/pageHandler');
		const { generateHeadElement } = await import(
			'../utils/generateHeadElement'
		);

		const response = await handleVuePageRequest(
			serverModule.default,
			serverPath,
			indexPath,
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
	} catch (err) {
		console.error('[Vue HMR] Error in handleVueUpdate:', err);
		return null;
	}
};
