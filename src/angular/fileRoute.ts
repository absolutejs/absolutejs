import type { FileRouteServerModuleFor } from '../../types/fileRoutes';
import {
	defineFileRouteWith,
	type FileRouteAdapterInput
} from '../core/fileRouteAdapter';
import { assetUnchecked } from '../core/lookup';
import { handleAngularPageRequest } from './pageHandler';

/** One Angular file route, as written by the generated route module.
 *
 *  Angular pages take no props: data reaches a component through DI, as
 *  the page's request context (`usePageContext<Context>()`). So what a
 *  route's `load` returns becomes that context rather than a props
 *  object — the same hook in a different place, and the reason `Context`
 *  is the type argument here where the other adapters take the page
 *  component's props. */
export const angularFileRoute = <
	Path extends string,
	Context,
	ServerModule extends FileRouteServerModuleFor<Path, Context>
>(
	route: FileRouteAdapterInput & {
		server?: () => Promise<ServerModule>;
	}
) =>
	defineFileRouteWith(
		'angular',
		route,
		async ({ manifest, props, request, ssr }) =>
			handleAngularPageRequest({
				indexPath: assetUnchecked(manifest, `${route.name}Index`),
				pagePath: assetUnchecked(manifest, route.name),
				request,
				/* `handleAngularPageRequest` makes `requestContext`
				 * required for a page whose `Context` has a required key,
				 * and the generated module cannot know which — `load`
				 * returning the context is what satisfies it. A route with
				 * no server module passes `{}`, which is what a page with
				 * no required context expects. */
				requestContext: props,
				ssr
			})
	);
