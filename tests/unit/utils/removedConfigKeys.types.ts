import type { BuildConfig } from '../../../types/build';

/* `astroDirectory` was declared, reserved and copied into the production
 * runtime, and read by nothing: there has never been an Astro adapter.
 * Setting it type-checked and did nothing. It is gone from the type, so a
 * config typed as `BuildConfig` that still sets it is told so.
 *
 * Only a typed config: `defineConfig` accepts any key it does not know,
 * this one and a misspelt real one alike, so there the key is ignored as
 * silently as it always was.
 *
 * This file is here and not beside the other config type tests in
 * tests/unit/build because tsconfig excludes every directory named
 * `build`, so nothing in that one is type-checked. */
const invalidAstroDirectory: BuildConfig = {
	// @ts-expect-error there is no Astro adapter to point at a directory.
	astroDirectory: 'src/astro',
	reactDirectory: 'src/react'
};

void invalidAstroDirectory;
