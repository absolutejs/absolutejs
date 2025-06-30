import { Glob } from 'bun';

export const scanEntryPoints = async (dir: string, pattern: string) => {
	const entryPaths: string[] = [];
	const glob = new Glob(pattern);
	for await (const file of glob.scan({ absolute: true, cwd: dir })) {
		entryPaths.push(file);
	}

	return entryPaths;
};
