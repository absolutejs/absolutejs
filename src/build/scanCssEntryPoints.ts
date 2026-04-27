import { existsSync } from 'node:fs';
import { Glob } from 'bun';
import { normalizePath } from '../utils/normalizePath';
import { isStyleModulePath } from './stylePreprocessor';

export const scanCssEntryPoints = async (dir: string, ignore?: string[]) => {
	// Gracefully handle missing directories — this happens during framework
	// scaffolding when the config references a directory being created.
	if (!existsSync(dir)) return [];

	const entryPaths: string[] = [];
	const glob = new Glob('**/*.{css,scss,sass,less,styl,stylus}');
	for await (const file of glob.scan({ absolute: true, cwd: dir })) {
		const normalized = normalizePath(file);
		if (
			isStyleModulePath(normalized) ||
			ignore?.some((pattern) => normalized.includes(pattern))
		)
			continue;

		entryPaths.push(file);
	}

	return entryPaths;
};
