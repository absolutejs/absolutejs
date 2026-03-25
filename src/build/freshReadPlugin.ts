import type { BunPlugin } from 'bun';

// Bun.build plugin that forces disk reads for changed files.
// Bun caches ESM modules at the process level — once imported,
// the cached version is used even if the file changed on disk.
// This plugin intercepts onLoad for changed files and reads
// fresh content from disk, bypassing the stale cache.
export const createFreshReadPlugin = (
	changedFiles: string[]
): BunPlugin => {
	const changed = new Set(changedFiles.map((f) => f.replace(/\\/g, '/')));

	// Build a regex that matches any of the changed file paths.
	// Escape regex special chars in file paths.
	const escaped = changedFiles.map((f) =>
		f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	);
	const pattern =
		escaped.length > 0
			? new RegExp(`(${escaped.join('|')})$`)
			: /(?!)/; // never matches

	return {
		name: 'fresh-read',
		setup(build) {
			build.onLoad({ filter: pattern }, async (args) => {
				const normalized = args.path.replace(/\\/g, '/');
				if (!changed.has(normalized)) return undefined;

				const contents = await Bun.file(args.path).text();
				const ext = args.path.split('.').pop();
				const loaderMap: Record<string, string> = {
					ts: 'ts',
					tsx: 'tsx',
					js: 'js',
					jsx: 'jsx',
					css: 'css'
				};

				return {
					contents,
					loader: (loaderMap[ext ?? ''] ?? 'ts') as
						| 'ts'
						| 'tsx'
						| 'js'
						| 'jsx'
						| 'css'
				};
			});
		}
	};
};
