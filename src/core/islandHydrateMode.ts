/* How a hydrate strategy becomes markup, in a module with no imports but
 * its type.
 *
 * Two places build an island's attributes: `core/islandMarkupAttributes.ts`
 * for every framework the server renders, and `svelte/components/
 * Island.svelte`, which ships as SOURCE and compiles in the user's project
 * so it cannot import the first one. They already wrote `data-hydrate`
 * separately, and adding `{ media: … }` to one and not the other would
 * mean a Svelte island silently hydrating immediately where a React one
 * waits for the query — the quiet divergence a shared module prevents.
 *
 * The build copies this file into dist/ beside the component, the same
 * arrangement as utils/iconVersion.ts. */

import type { IslandHydrate, IslandHydrateMode } from '../../types/island';

/** The query for `{ media: … }`, or undefined for every other strategy. */
export const hydrateMediaOf = (
	hydrate: IslandHydrate | IslandHydrateMode | undefined
) => (typeof hydrate === 'object' ? hydrate.media : undefined);

/** The word `data-hydrate` carries. `{ media: … }` renders as `media`,
 *  with the query in `data-hydrate-media`: a media query contains colons,
 *  parentheses and spaces, and none of that should have to survive being
 *  packed into one attribute and parsed back out. */
export const hydrateModeOf = (
	hydrate: IslandHydrate | IslandHydrateMode | undefined
) => {
	if (hydrate === undefined) return 'load';
	const mode: IslandHydrateMode =
		typeof hydrate === 'object' ? 'media' : hydrate;

	return mode;
};
