import { computed } from 'vue';

/** Route parameters can disappear before the outgoing page unmounts. */
export type VueRouteParam = string | readonly string[] | null | undefined;

/** Select the first segment without inventing a value for an absent parameter. */
export const getRouteParam = (value: VueRouteParam) => {
	if (value === null || value === undefined) return undefined;

	return typeof value === 'string' ? value : value[0];
};

/** Pass a getter so navigation stays reactive. The result remains optional even
 * for required path parameters: an outgoing page can observe the next route.
 * Accepting a getter avoids importing a second copy of vue-router and its
 * injection symbols into the framework's browser bundle. */
export const useRouteParam = (read: () => VueRouteParam) =>
	computed(() => getRouteParam(read()));
