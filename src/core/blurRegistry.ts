/* The blur map this process serves, loaded once from the build.
 *
 * Separate from `src/build/blurPlaceholders.ts` so the server does not
 * import the generator — that one pulls in `Bun.Image` to make the
 * thumbnails, which is build-time work with no place in a request path.
 *
 * Loaded lazily and remembered, including the empty result: a build
 * without the file is a project that never generated placeholders, and
 * re-reading a missing file on every page render would be a syscall per
 * request for an answer that cannot change. */

import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import type { BlurPlaceholders } from '../build/blurPlaceholders';

const BLUR_FILE = 'blur-placeholders.json';

let loaded: BlurPlaceholders | undefined = undefined;

/** Testing, and the dev server rebuilding in place. */
export const clearBlurPlaceholders = () => {
	loaded = undefined;
};

export const currentBlurPlaceholders = () => {
	if (loaded !== undefined) return loaded;
	const buildDir = process.env.ABSOLUTE_BUILD_DIR;
	if (buildDir === undefined || buildDir.length === 0) {
		loaded = {};

		return loaded;
	}
	try {
		const parsed: unknown = JSON.parse(
			readFileSync(join(buildDir, BLUR_FILE), 'utf8')
		);
		const entries =
			typeof parsed === 'object' && parsed !== null
				? Object.entries(parsed)
				: [];
		loaded = Object.fromEntries(
			entries.filter(
				(entry): entry is [string, string] =>
					typeof entry[1] === 'string'
			)
		);
	} catch {
		/* No placeholders generated, or a file that is not readable: the
		 * page renders without them, which is what it did before. */
		loaded = {};
	}

	return loaded;
};
