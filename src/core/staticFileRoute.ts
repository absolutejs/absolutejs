import type { FileRouteContext } from '../../types/fileRoutes';
import {
	defineFileRouteWith,
	type FileRouteAdapterInput
} from './fileRouteAdapter';
import { assetUnchecked } from './lookup';
import { handleHTMLPageRequest, handleHTMXPageRequest } from './pageHandlers';

/* HTML and HTMX file routes.
 *
 * A static page is served as the file the build produced, so unlike the
 * framework adapters there is nothing to hydrate and no props to render
 * with. That is also why `fileRoutePath` refuses a `[param]`,
 * `[...catchAll]` or `[[optional]]` segment for these two: a matched value
 * would have nowhere to go, and every value of it would serve
 * byte-identical markup. A `(group)` folder is allowed, since it
 * contributes no segment.
 *
 * The server module is therefore narrower than a framework route's: a
 * `beforeHandle` guard (redirect an unauthenticated visitor, say) is
 * useful and runs, but `load` is not part of the type, because props it
 * returned would be silently dropped. */
export type StaticFileRouteServerModule<Path extends string = string> = {
	beforeHandle?: (context: FileRouteContext<Path>) => unknown;
};

/** One HTML file route, as written by the generated route module. */
export const htmlFileRoute = <
	Path extends string,
	ServerModule extends StaticFileRouteServerModule<Path> | undefined
>(
	route: FileRouteAdapterInput & {
		server?: () => Promise<ServerModule>;
	}
) =>
	defineFileRouteWith('html', route, async ({ manifest }) =>
		handleHTMLPageRequest(assetUnchecked(manifest, route.name))
	);

/** One HTMX file route, as written by the generated route module. */
export const htmxFileRoute = <
	Path extends string,
	ServerModule extends StaticFileRouteServerModule<Path> | undefined
>(
	route: FileRouteAdapterInput & {
		server?: () => Promise<ServerModule>;
	}
) =>
	defineFileRouteWith('htmx', route, async ({ manifest }) =>
		handleHTMXPageRequest(assetUnchecked(manifest, route.name))
	);
