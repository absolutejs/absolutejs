/* Simple Angular HMR Implementation
   Lightweight approach: use rebuilt files → re-render → send HTML patch */

import { basename, resolve } from 'node:path';
import { toPascal } from '../utils/stringModifiers';

/* Simple Angular HMR handler for server-side
   When an Angular file changes:
   1. The rebuild already compiled Angular and updated the manifest
   2. Derive manifest keys dynamically from the source file path
   3. Replay last-used props from the route cache (Vite/Next behavior)
   4. Use manifest paths to call handleAngularPageRequest (which does its own import)
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

		const absoluteServerPath = /^[A-Za-z]:[\\/]/.test(serverPath)
			? serverPath
			: resolve(buildDir || process.cwd(), serverPath.replace(/^\//, ''));

		const serverModule = await import(
			`${absoluteServerPath}${cacheBuster}`
		);

		if (!serverModule) {
			console.warn(
				'[Angular HMR] Failed to import module:',
				absoluteServerPath
			);

			return null;
		}

		const { handleAngularPageRequest, getCachedRouteData } = await import(
			'../angular/pageHandler'
		);
		const { generateHeadElement } = await import(
			'../utils/generateHeadElement'
		);

		// Replay last-used props from the route cache — the user sees
		// the same data they had on their last real request (Vite/Next behavior).
		// Falls back to the original serverPath key for cache lookup since
		// HMR paths have cache-busters appended.
		const cached = getCachedRouteData(serverPath);
		const headTag =
			cached?.headTag ??
			generateHeadElement({
				cssPath: manifest[cssKey] || '',
				title: 'AbsoluteJS + Angular'
			});

		const importer = () =>
			Promise.resolve({
				factory: serverModule.default as (
					props: Record<string, unknown>
				) => unknown
			});

		const response = await handleAngularPageRequest(
			importer,
			serverPathWithCacheBuster,
			indexPath,
			headTag,
			cached?.props ?? {}
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

		// Return the full HTML — the client handler extracts both:
		// - <head> content (Angular's <style> tags from component CSS)
		// - #root / <body> content (rendered component markup)
		// Sending body-only would lose Angular SSR's <style> tags from <head>.
		return html;
	} catch (err) {
		console.error('[Angular HMR] Error in handleAngularUpdate:', err);

		return null;
	}
};
