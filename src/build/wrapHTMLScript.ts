/**
 * Wraps HTML/HTMX TypeScript/JavaScript scripts with import.meta.hot support
 * for granular HMR updates. This allows script changes to hot-reload
 * without triggering a full HTML page rebuild.
 *
 * The wrapper is minimal - it just adds import.meta.hot.accept() so Bun
 * knows this module can be hot-reloaded. Event listener cleanup is handled
 * by the HMR client (cloning elements before script re-execution).
 */

/**
 * Wrap a script with HMR support using Bun's import.meta.hot API
 * @param code - The original script code
 * @param scriptId - Unique identifier for this script (usually the file path)
 * @returns Wrapped code with HMR support
 */
export function wrapHTMLScriptWithHMR(code: string, scriptId: string): string {
	const escapedId = JSON.stringify(scriptId);

	return `${code}

// HMR acceptance - allows this script to be hot-reloaded
if (typeof import.meta !== "undefined" && import.meta.hot) {
  import.meta.hot.accept();
  console.log('[HMR] Script ready:', ${escapedId});
}
`;
}

/**
 * Check if a file path is an HTML/HTMX script that should be wrapped
 * @param filePath - The file path to check
 * @param htmlDir - The HTML directory path
 * @param htmxDir - The HTMX directory path
 * @returns true if this script should be wrapped with HMR
 */
export function isHTMLScript(
	filePath: string,
	htmlDir?: string,
	htmxDir?: string
): boolean {
	const normalizedPath = filePath.replace(/\\/g, '/');
	const isScript = /\.(ts|js|tsx|jsx)$/.test(normalizedPath);

	if (!isScript) return false;

	// Check if it's in the HTML or HTMX directory
	if (htmlDir) {
		const normalizedHtmlDir = htmlDir.replace(/\\/g, '/');
		if (normalizedPath.startsWith(normalizedHtmlDir)) return true;
	}

	if (htmxDir) {
		const normalizedHtmxDir = htmxDir.replace(/\\/g, '/');
		if (normalizedPath.startsWith(normalizedHtmxDir)) return true;
	}

	return false;
}
