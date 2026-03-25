import type { BunPlugin } from 'bun';
import { readFileSync } from 'node:fs';

// Bun.build plugin that forces disk reads for changed files.
// Bun caches ESM modules at the process level with no invalidation
// API. This plugin intercepts onLoad for changed files and reads
// fresh content from disk.
//
// NOTE: Bun.build may skip onLoad for modules already in its cache.
// If that happens, the build output will contain stale content.
// The workaround is to use a subprocess for builds that need fresh
// reads (see freshBuild.ts).
export const createFreshReadPlugin = (
	changedFiles: string[]
): BunPlugin => {
	const changed = new Set(
		changedFiles.map((f) => f.replace(/\\/g, '/'))
	);

	return {
		name: 'fresh-read',
		setup(build) {
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
