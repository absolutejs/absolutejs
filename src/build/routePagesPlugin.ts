import type { BunPlugin } from 'bun';
import { splitRoutePages } from './splitRoutePages';

/* The app's own React files (not a package's). */
const PROJECT_REACT_FILE = /^(?!.*[\\/]node_modules[\\/]).*\.[jt]sx$/;

/** Makes the pages in a React router load when first shown, in a Bun
 *  build (splitRoutePages.ts). Every build that bundles the app's React
 *  source uses it, browser and server alike, so both render the same
 *  boundaries. Files with no router pass through untouched. */
export const createRoutePagesPlugin = (): BunPlugin => ({
	name: 'absolute-route-pages',
	setup(build) {
		build.onLoad({ filter: PROJECT_REACT_FILE }, async (args) => {
			const split = splitRoutePages(
				await Bun.file(args.path).text(),
				args.path
			);
			if (split === null) return undefined;

			return {
				contents: split,
				loader: args.path.endsWith('.jsx') ? 'jsx' : 'tsx'
			};
		});
	}
});
