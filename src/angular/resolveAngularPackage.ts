import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Resolve an Angular package path from process.cwd()/node_modules/ first,
 * falling back to the bare specifier. This prevents Bun's baked import.meta.dir
 * from resolving Angular packages from the absolutejs source tree instead of
 * the consumer's project when running from a published npm package.
 */
export const resolveAngularPackage = (specifier: string) => {
	const fromProject = resolve(process.cwd(), 'node_modules', specifier);

	if (existsSync(fromProject)) {
		return fromProject;
	}

	return specifier;
};
