import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path';

/** Mirror source paths under each compilation mode. Using the filesystem root
 * preserves relative imports, including imports outside the configured Vue
 * directory, without letting parent traversals escape the client/server tree.
 * Encode the root separately so Windows drives and UNC roots cannot collide. */
export const vueModuleOutputPath = (outputDir: string, sourcePath: string) => {
	const absolutePath = resolve(sourcePath);
	const { root } = parse(absolutePath);

	return join(
		outputDir,
		'sources',
		encodeURIComponent(root),
		relative(root, absolutePath).replace(/\.(vue|ts)$/, '.js')
	);
};

/** Reverse the generated mirror for composable hot-reload module identities. */
export const vueModuleSourcePath = (outputDir: string, outputPath: string) => {
	const within = relative(outputDir, outputPath);
	if (isAbsolute(within) || within === '..' || within.startsWith(`..${sep}`))
		return null;
	const [namespace, encodedRoot, ...parts] = within.split(sep);
	if (namespace !== 'sources' || !encodedRoot || !parts.length) return null;
	try {
		const root = decodeURIComponent(encodedRoot);
		if (parse(root).root !== root || !isAbsolute(root)) return null;

		return join(root, ...parts);
	} catch {
		return null;
	}
};
