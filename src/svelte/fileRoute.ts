import type { Component } from 'svelte';
import type { FileRouteServerModuleFor } from '../../types/fileRoutes';
import type { SveltePropsOf } from '../../types/svelte';
import {
	defineFileRouteWith,
	type FileRouteAdapterInput
} from '../core/fileRouteAdapter';
import { assetUnchecked } from '../core/lookup';
import { handleSveltePageRequest } from './pageHandler';

type PagePropsOf<PageModule> = PageModule extends { default: infer Page }
	? SveltePropsOf<Page>
	: never;

/** One Svelte file route, as written by the generated route module. The page
 *  renders from its compiled module in the manifest; `PageModule` (the
 *  `.svelte` file's type) only types the props `load` has to return. */
export const svelteFileRoute = <
	Path extends string,
	PageModule extends { default: unknown },
	ServerModule extends FileRouteServerModuleFor<Path, PagePropsOf<PageModule>>
>(
	route: FileRouteAdapterInput & {
		server?: () => Promise<ServerModule>;
	}
) =>
	defineFileRouteWith(
		'svelte',
		route,
		async ({ manifest, props, request, ssr }) =>
			handleSveltePageRequest<Component<Record<string, unknown>>>({
				indexPath: assetUnchecked(manifest, `${route.name}Index`),
				pagePath: assetUnchecked(manifest, route.name),
				props,
				request,
				ssr
			})
	);
