/**
 * Bun build plugin that wraps HTML/HTMX scripts with import.meta.hot support
 * for granular HMR. This allows script changes to hot-reload independently
 * without triggering a full HTML page rebuild.
 */

import type { BunPlugin } from 'bun';
import { wrapHTMLScriptWithHMR } from './wrapHTMLScript';

/**
 * Creates a Bun build plugin that wraps HTML/HTMX scripts with HMR support
 * @param htmlDir - The HTML directory path (normalized with forward slashes)
 * @param htmxDir - The HTMX directory path (normalized with forward slashes)
 * @returns Bun build plugin
 */
export function createHTMLScriptHMRPlugin(
	htmlDir?: string,
	htmxDir?: string
): BunPlugin {
	return {
		name: 'html-script-hmr',
		setup(build) {
			// Only apply to TypeScript/JavaScript files
			build.onLoad({ filter: /\.(ts|js|tsx|jsx)$/ }, async (args) => {
				const normalizedPath = args.path.replace(/\\/g, '/');

				// Check if this file is in the HTML or HTMX scripts directory
				const isHtmlScript =
					htmlDir &&
					normalizedPath.includes(htmlDir.replace(/\\/g, '/')) &&
					normalizedPath.includes('/scripts/');
				const isHtmxScript =
					htmxDir &&
					normalizedPath.includes(htmxDir.replace(/\\/g, '/')) &&
					normalizedPath.includes('/scripts/');

				if (!isHtmlScript && !isHtmxScript) {
					// Not an HTML/HTMX script, let Bun handle it normally
					return undefined;
				}

				// Read the original script content
				const text = await Bun.file(args.path).text();

				// Wrap with HMR support
				const wrapped = wrapHTMLScriptWithHMR(text, normalizedPath);

				// Determine the loader based on file extension
				const ext = args.path.split('.').pop() || 'ts';
				const loader = ext as 'ts' | 'js' | 'tsx' | 'jsx';

				return {
					contents: wrapped,
					loader
				};
			});
		}
	};
}
