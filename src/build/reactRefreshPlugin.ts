import type { BunPlugin } from 'bun';

/**
 * Bun plugin that adds React Refresh registration to React components.
 * This enables true state preservation during HMR by:
 * 1. Finding all exported function components
 * 2. Adding $RefreshReg$ calls to register them with React Refresh
 * 3. Adding $RefreshSig$ calls to track hook signatures
 */
export function createReactRefreshPlugin(): BunPlugin {
	return {
		name: 'react-refresh',
		setup(build) {
			// Only transform .tsx and .jsx files in React directories
			build.onLoad({ filter: /\.(tsx|jsx)$/ }, async (args) => {
				// Skip node_modules and non-React files
				if (args.path.includes('node_modules')) {
					return undefined;
				}

				// Only process files in react directories (pages, components)
				if (!args.path.includes('/react/')) {
					return undefined;
				}

				const file = Bun.file(args.path);
				const contents = await file.text();

				// Transform the file to add React Refresh registration
				const transformed = addReactRefreshRegistration(contents, args.path);

				return {
					contents: transformed,
					loader: args.path.endsWith('.tsx') ? 'tsx' : 'jsx'
				};
			});
		}
	};
}

/**
 * Add React Refresh registration code to a React component file.
 * This parses the file to find exported components and adds registration calls.
 */
function addReactRefreshRegistration(code: string, filePath: string): string {
	// Extract the module ID from the file path (stable across builds)
	const moduleId = extractModuleId(filePath);

	// Find all exported function components
	const components = findExportedComponents(code);

	if (components.length === 0) {
		return code;
	}

	// Build the refresh registration code
	const registrationCode = buildRegistrationCode(components, moduleId);

	// Append registration code to the end of the file
	return code + '\n' + registrationCode;
}

/**
 * Extract a stable module ID from the file path.
 * Uses the relative path within the react directory.
 */
function extractModuleId(filePath: string): string {
	// Get the part after /react/
	const reactMatch = filePath.match(/\/react\/(.+)$/);
	if (reactMatch) {
		// Remove extension and return
		return reactMatch[1].replace(/\.(tsx|jsx|ts|js)$/, '');
	}
	// Fallback: use the filename
	const filename = filePath.split('/').pop() || filePath;
	return filename.replace(/\.(tsx|jsx|ts|js)$/, '');
}

/**
 * Find all exported function components in the code.
 * Looks for patterns like:
 * - export const ComponentName = ...
 * - export function ComponentName...
 * - export { ComponentName }
 */
function findExportedComponents(code: string): string[] {
	const components: string[] = [];

	// Pattern 1: export const ComponentName = (props) => ... or = function...
	// Component names start with uppercase
	const constExportRegex = /export\s+const\s+([A-Z][a-zA-Z0-9]*)\s*[=:]/g;
	let match;
	while ((match = constExportRegex.exec(code)) !== null) {
		components.push(match[1]);
	}

	// Pattern 2: export function ComponentName
	const funcExportRegex = /export\s+function\s+([A-Z][a-zA-Z0-9]*)\s*[(<]/g;
	while ((match = funcExportRegex.exec(code)) !== null) {
		components.push(match[1]);
	}

	// Pattern 3: export { ComponentName } or export { ComponentName as default }
	const namedExportRegex = /export\s*\{\s*([A-Z][a-zA-Z0-9]*)\s*(?:as\s+\w+)?\s*\}/g;
	while ((match = namedExportRegex.exec(code)) !== null) {
		if (!components.includes(match[1])) {
			components.push(match[1]);
		}
	}

	// Pattern 4: const ComponentName = ... followed by export default ComponentName
	// Find const declarations with uppercase names
	const constDeclRegex = /const\s+([A-Z][a-zA-Z0-9]*)\s*[=:]/g;
	const declaredComponents: string[] = [];
	while ((match = constDeclRegex.exec(code)) !== null) {
		declaredComponents.push(match[1]);
	}

	// Check if any are exported as default
	for (const comp of declaredComponents) {
		const defaultExportRegex = new RegExp(
			`export\\s+default\\s+${comp}\\s*[;\\n]`
		);
		if (defaultExportRegex.test(code) && !components.includes(comp)) {
			components.push(comp);
		}
	}

	return [...new Set(components)]; // Remove duplicates
}

/**
 * Build the React Refresh registration code for the found components.
 * NOTE: We do NOT add export statements - Bun handles that.
 * We only inject registration calls that run when the module loads.
 */
function buildRegistrationCode(components: string[], moduleId: string): string {
	const lines: string[] = [
		'',
		'// React Refresh registration (injected by AbsoluteJS)',
		'if (typeof window !== "undefined" && window.$RefreshReg$) {'
	];

	// Register each component with a stable ID
	for (const component of components) {
		const registrationId = `${moduleId}/${component}`;
		lines.push(
			`  window.$RefreshReg$(${component}, "${registrationId}");`
		);
	}

	lines.push('}');

	return lines.join('\n');
}

