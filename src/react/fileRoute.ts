import type { ComponentType } from 'react';
import type { FileRouteServerModuleFor } from '../../types/fileRoutes';
import {
	defineFileRouteWith,
	type FileRouteAdapterInput
} from '../core/fileRouteAdapter';
import { asset } from '../core/lookup';
import { handleReactPageRequest } from './pageHandler';

type PagePropsOf<PageModule> = PageModule extends {
	default: ComponentType<infer Props>;
}
	? Props
	: never;

type RenderableComponent = ComponentType<Record<string, unknown>>;

type ReactFileRouteInput<
	Path extends string,
	PageModule,
	ServerModule
> = FileRouteAdapterInput<Path> & {
	page: () => Promise<PageModule>;
	server?: () => Promise<ServerModule>;
};

const isReactComponent = (value: unknown): value is RenderableComponent =>
	typeof value === 'function' ||
	(typeof value === 'object' && value !== null && '$$typeof' in value);

/** One React file route, as written by the generated route module. The
 *  type arguments check the route at compile time: `ServerModule`'s `load`
 *  must accept this path's params and return the page component's props
 *  (and must exist when the page has required props). */
export const reactFileRoute = <
	Path extends string,
	PageModule extends { default: unknown },
	ServerModule extends FileRouteServerModuleFor<Path, PagePropsOf<PageModule>>
>(
	route: ReactFileRouteInput<Path, PageModule, ServerModule>
) =>
	defineFileRouteWith(
		'react',
		route,
		async ({ manifest, props, request }) => {
			const { default: Page } = await route.page();
			if (!isReactComponent(Page)) {
				throw new Error(
					`File route ${route.source} has no default-exported React component.`
				);
			}

			return handleReactPageRequest<Record<string, unknown>>({
				index: asset(manifest, `${route.name}Index`),
				Page,
				props,
				request
			});
		}
	);
