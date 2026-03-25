import type { BunPlugin } from 'bun';
import { readFileSync } from 'node:fs';

// Bun.build plugin that forces disk reads for changed files.
// Bun caches ESM modules at the process level — once imported,
// the cached version is used even if the file changed on disk.
// This plugin intercepts onLoad for ALL .ts/.tsx files during
// incremental builds. For changed files, it reads fresh content
// from disk. For unchanged files, it returns undefined (default).
export const createFreshReadPlugin = (
	changedFiles: string[]
): BunPlugin => {
	const changed = new Set(
		changedFiles.map((f) => f.replace(/\\/g, '/'))
	);

	return {
		name: 'fresh-read',
		setup(build) {
			// Match all TS/JS files — we check the path inside
			build.onLoad(
				{ filter: /\.(tsx?|jsx?)$/ },
				(args) => {
					const normalized = args.path.replace(/\\/g, '/');
					if (!changed.has(normalized)) return undefined;

					const contents = readFileSync(args.path, 'utf-8');
					const ext = args.path.split('.').pop();
					const loaderMap: Record<string, string> = {
						ts: 'ts',
						tsx: 'tsx',
						js: 'js',
						jsx: 'jsx'
					};

					return {
						contents,
						loader: (loaderMap[ext ?? ''] ?? 'ts') as
							| 'ts'
							| 'tsx'
							| 'js'
							| 'jsx'
					};
				}
			);
		}
	};
};
