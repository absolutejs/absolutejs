import { Glob } from 'bun';
import { normalizePath } from '../utils/normalizePath';

export const scanCssEntryPoints = async (
	dir: string,
	ignore?: string[]
) => {
	const entryPaths: string[] = [];
	const glob = new Glob('**/*.css');
	for await (const file of glob.scan({ absolute: true, cwd: dir })) {
		const normalized = normalizePath(file);
		if (
			ignore?.some((pattern) => normalized.includes(pattern))
		)
			continue;

		entryPaths.push(file);
	}

	return entryPaths;
};
