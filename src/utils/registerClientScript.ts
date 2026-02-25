/**
 * Utility for registering client-side scripts that need to run after Angular SSR hydration.
 *
 * This is necessary because Angular's lifecycle hooks don't always run reliably on the client
 * after SSR hydration, especially for event listeners attached to DOM elements.
 *
 * Usage in Angular components:
 * ```typescript
 * import { registerClientScript } from '@absolutejs/absolute';
 *
 * // Register an event listener script
 * registerClientScript(() => {
 *   const element = document.querySelector('.my-element');
 *   if (element) {
 *     element.addEventListener('click', () => {
 *       console.log('Clicked!');
 *     });
 *   }
 * });
 * ```
 *
 * The script will be automatically injected into the HTML response and executed on the client.
 */

// Request-scoped registry for client scripts
// Each request gets its own set of scripts to inject
const scriptRegistry = new Map<string, Set<() => void>>();

// Generate a unique request ID for tracking scripts per request
let requestCounter = 0;
const getRequestId = () => `req_${Date.now()}_${++requestCounter}`;

// Allow SSR frameworks to inject a request context getter (e.g. AsyncLocalStorage)
let ssrContextGetter: (() => string | undefined) | null = null;
export const setSsrContextGetter = (getter: () => string | undefined) => {
	ssrContextGetter = getter;
};

/**
 * Register a client-side script to be injected into the HTML response.
 *
 * @param script - A function containing the client-side code to execute
 * @param requestId - Optional request ID. If not provided, uses the current request context.
 * @returns The request ID for this script registration
 */
export const registerClientScript = (
	script: () => void,
	requestId?: string
) => {
	// Try to get requestId from explicit arg, then Async Context, then global fallback
	const id =
		requestId ||
		ssrContextGetter?.() ||
		(globalThis as any).__absolutejs_requestId ||
		getRequestId();

	if (!scriptRegistry.has(id)) {
		scriptRegistry.set(id, new Set());
	}

	scriptRegistry.get(id)!.add(script);

	return id;
};

// Make registerClientScript available globally during SSR for Angular components
// Using type assertion for globalThis extension
if (typeof globalThis !== 'undefined') {
	(
		globalThis as {
			registerClientScript?: (script: () => void) => string;
		}
	).registerClientScript = registerClientScript;
}

/**
 * Get all registered scripts for a request and clear them.
 * This is called by the page handler after rendering.
 *
 * @param requestId - The request ID to get scripts for
 * @returns Array of script functions, or empty array if none registered
 */
export const getAndClearClientScripts = (requestId?: string) => {
	const id = requestId || ssrContextGetter?.();
	if (!id) return [];

	const scripts = scriptRegistry.get(id);
	if (!scripts) {
		return [];
	}

	const scriptArray = Array.from(scripts);
	scriptRegistry.delete(id);

	return scriptArray;
};

/**
 * Generate JavaScript code from registered scripts.
 * Wraps each script in an IIFE and combines them.
 *
 * @param scripts - Array of script functions
 * @returns JavaScript code string to inject
 */
export const generateClientScriptCode = (scripts: (() => void)[]) => {
	if (scripts.length === 0) {
		return '';
	}

	// Convert functions to strings and wrap in IIFE
	const scriptCode = scripts
		.map((script, index) => {
			// Get the function body as a string
			const funcString = script.toString();

			// Extract the body (everything between { and })
			const bodyMatch = funcString.match(/\{([\s\S]*)\}/);
			if (!bodyMatch || !bodyMatch[1]) {
				return '';
			}

			const body = bodyMatch[1].trim();

			// Wrap in IIFE with retry logic for DOM readiness
			return `
	(function() {
		function executeScript_${index}() {
			${body}
		}

		// Try executing immediately if DOM is ready
		if (document.readyState === 'complete' || document.readyState === 'interactive') {
			executeScript_${index}();
		} else {
			document.addEventListener('DOMContentLoaded', executeScript_${index});
		}

		// Also try with delays to ensure element is available after hydration
		setTimeout(executeScript_${index}, 100);
		setTimeout(executeScript_${index}, 300);
		setTimeout(executeScript_${index}, 500);
		setTimeout(executeScript_${index}, 1000);

		// Fallback on window load
		window.addEventListener('load', executeScript_${index});
	})();`;
		})
		.join('\n');

	return `<script>
(function() {
${scriptCode}
})();
</script>`;
};

/**
 * Clear all registered scripts (useful for cleanup or testing)
 */
export const clearAllClientScripts = () => {
	scriptRegistry.clear();
};
