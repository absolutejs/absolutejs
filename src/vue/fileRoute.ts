import type { FileRouteServerModuleFor } from '../../types/fileRoutes';
import type { VuePropsOf } from '../../types/vue';
import {
	defineFileRouteWith,
	type FileRouteAdapterInput
} from '../core/fileRouteAdapter';
import { assetUnchecked } from '../core/lookup';
import { handleVuePageRequest } from './pageHandler';

type PagePropsOf<PageModule> = PageModule extends { default: infer Page }
	? VuePropsOf<Page>
	: never;

/** One Vue file route, as written by the generated route module. Like the
 *  Svelte adapter, the page renders from its compiled module in the
 *  manifest — the `.vue` source is never imported on the server — so
 *  `PageModule` is here only to type the props `load` has to return. */
export const vueFileRoute = <
	Path extends string,
	PageModule extends { default: unknown },
	ServerModule extends FileRouteServerModuleFor<Path, PagePropsOf<PageModule>>
>(
	route: FileRouteAdapterInput & {
		server?: () => Promise<ServerModule>;
	}
) =>
	defineFileRouteWith(
		'vue',
		route,
		async ({ manifest, props, request, ssr }) =>
			handleVuePageRequest({
				indexPath: assetUnchecked(manifest, `${route.name}Index`),
				pagePath: assetUnchecked(manifest, route.name),
				props,
				request,
				ssr
			})
	);
