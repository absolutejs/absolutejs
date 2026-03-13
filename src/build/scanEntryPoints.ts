import { existsSync } from 'node:fs';
import { Glob } from 'bun';

export const scanEntryPoints = async (dir: string, pattern: string) => {
	// Gracefully handle missing directories — this happens during framework
	// scaffolding when the config references a directory being created.
	if (!existsSync(dir)) return [];

	const entryPaths: string[] = [];
	const glob = new Glob(pattern);
	for await (const file of glob.scan({ absolute: true, cwd: dir })) {
		entryPaths.push(file);
	}

	return entryPaths;
};
