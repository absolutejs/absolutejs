import type { BunPlugin } from 'bun';
import { resolveIslandCompatModule } from './islandBindingCompat';

export const createIslandBindingPlugin = (frameworkDirs: {
	angular?: string;
	react?: string;
	svelte?: string;
	vue?: string;
}): BunPlugin => ({
	name: 'absolute-island-binding-plugin',
	setup(build) {
		build.onResolve(
			{
				filter:
					/^@absolutejs\/absolute\/(react|vue|svelte|angular)$/
			},
			(args) => {
				const redirected = resolveIslandCompatModule(
					args.path,
					args.importer,
					frameworkDirs
				);
				if (!redirected) return undefined;

				return {
					path: redirected
				};
			}
		);
	}
});
