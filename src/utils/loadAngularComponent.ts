/**
 * Type-safe utility for loading Angular components from compiled output.
 * This replaces the manual file searching approach with a more maintainable solution.
 */

import { readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import type { AngularComponentModule } from '../types';

/**
 * Recursively find a file in a directory tree
 */
function findFileInDirectory(dir: string, filename: string): string | null {
	try {
		const entries = readdirSync(dir);
		for (const entry of entries) {
			const fullPath = join(dir, entry);
			const stat = statSync(fullPath);
			if (stat.isDirectory()) {
				const found = findFileInDirectory(fullPath, filename);
				if (found) return found;
			} else if (entry === filename) {
				return fullPath;
			}
		}
	} catch {
		// Directory doesn't exist or permission error
	}
	return null;
}

/**
 * Load an Angular component module from the compiled output directory.
 * 
 * @param compiledDirectory - The directory where Angular compiles output (e.g., 'example/angular/compiled')
 * @param componentName - The name of the component file to find (e.g., 'angular-example.js')
 * @returns The loaded Angular component module with proper types
 * @throws Error if the component file is not found
 */
export async function loadAngularComponent(
	compiledDirectory: string,
	componentName: string
): Promise<AngularComponentModule> {
	const absoluteDir = resolve(process.cwd(), compiledDirectory);
	const componentFile = findFileInDirectory(absoluteDir, componentName);
	
	if (!componentFile) {
		throw new Error(
			`Angular compiled component not found: ${componentName} in ${compiledDirectory}`
		);
	}
	
	// Dynamic import with type assertion
	const module = await import(componentFile) as AngularComponentModule;
	
	// Validate that the module has the required default export
	if (!module.default) {
		throw new Error(
			`Angular component module ${componentName} does not have a default export`
		);
	}
	
	return module;
}


