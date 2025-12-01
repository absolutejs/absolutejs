/**
 * Type-safe helper to get the registerClientScript function during SSR.
 * 
 * This function safely accesses the global registerClientScript that's made
 * available during Angular SSR rendering. It returns null if not available
 * (e.g., when running outside of SSR context).
 * 
 * @returns The registerClientScript function if available, null otherwise
 */
export function getRegisterClientScript(): ((script: () => void) => string) | null {
	// Type-safe access to global registerClientScript
	const globalRegister = (globalThis as {
		registerClientScript?: (script: () => void) => string;
	}).registerClientScript;
	
	if (globalRegister && typeof globalRegister === 'function') {
		return globalRegister;
	}
	
	return null;
}

