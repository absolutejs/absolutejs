/* The preload map this process serves, loaded once from the build.
 *
 * Separate from `src/build/modulePreload.ts` so the server never imports
 * the graph walker: that one reads every emitted module to follow its
 * imports, which is build-time work with no place in a request path.
 *
 * The empty result is remembered too. A build without the file is a
 * project that never generated one, and re-reading a missing file per
 * response would be a syscall on the hot path for an answer that cannot
 * change. */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModulePreloadMap } from '../build/modulePreload';

const PRELOAD_FILE = 'modulepreload.json';

let loaded: ModulePreloadMap | undefined = undefined;

/** Testing, and a dev server rebuilding in place. */
export const clearModulePreloadMap = () => {
	loaded = undefined;
};

const loadMap = () => {
	const buildDir = process.env.ABSOLUTE_BUILD_DIR;
	try {
		const parsed: unknown = JSON.parse(
			readFileSync(join(buildDir ?? '', PRELOAD_FILE), 'utf8')
		);
		if (typeof parsed !== 'object' || parsed === null) return {};
		const pairs = Object.entries(parsed).filter(
			(pair): pair is [string, string[]] => Array.isArray(pair[1])
		);

		return Object.fromEntries(pairs) satisfies ModulePreloadMap;
	} catch {
		/* No map generated, or unreadable: pages render exactly as they
		 * did before, just without the preloads. */
		return {};
	}
};

export const modulePreloadsFor = (entry: string | undefined) => {
	if (entry === undefined || entry.length === 0) return [];
	loaded ??= loadMap();

	return loaded[entry] ?? [];
};
