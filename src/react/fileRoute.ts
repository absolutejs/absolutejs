import type { ComponentType } from 'react';
import type { FileRouteServerModuleFor } from '../../types/fileRoutes';
import {
	defineFileRouteWith,
	type FileRouteAdapterInput
} from '../core/fileRouteAdapter';
import { assetUnchecked } from '../core/lookup';
import { handleReactPageRequest } from './pageHandler';

type PagePropsOf<PageModule> = PageModule extends {
	default: ComponentType<infer Props>;
}
	? Props
	: never;

type RenderableComponent = ComponentType<Record<string, unknown>>;

/* No `Path` parameter: the route's typed path reaches the adapter through
 * `ServerModule`, which `reactFileRoute` constrains against it. The
 * registered `path` on `FileRouteAdapterInput` is a plain string, because a
 * catch-all or optional route registers a different string than it types
 * against. */
type ReactFileRouteInput<PageModule, ServerModule> = FileRouteAdapterInput & {
	page: () => Promise<PageModule>;
	/** `layout.tsx` modules wrapping this route, outermost first. */
	layouts?: readonly (() => Promise<unknown>)[];
	server?: () => Promise<ServerModule>;
};

const isReactComponent = (value: unknown): value is RenderableComponent =>
	typeof value === 'function' ||
	(typeof value === 'object' && value !== null && '$$typeof' in value);

const defaultExportOf = (module: unknown) =>
	typeof module === 'object' && module !== null
		? Reflect.get(module, 'default')
		: undefined;

/* The page wrapped in its layouts, innermost last.
 *
 * `reduceRight` over an outermost-first chain puts the first layout on the
 * outside, which is the order the hydration index composes them in too —
 * they have to agree, or the client rebuilds a different tree than the
 * server sent and React discards the whole thing. */
const composeLayouts = async (
	Page: RenderableComponent,
	layouts: readonly (() => Promise<unknown>)[],
	source: string
) => {
	const { createElement } = await import('react');
	const loaded = await Promise.all(layouts.map((load) => load()));
	const components = loaded.map((module, index) => {
		const Layout = defaultExportOf(module);
		if (!isReactComponent(Layout)) {
			throw new Error(
				`Layout ${index + 1} of ${layouts.length} for file route ${source} has no default-exported React component.`
			);
		}

		return Layout;
	});

	const Composed = (props: Record<string, unknown>) =>
		components.reduceRight(
			(node, Layout) => createElement(Layout, null, node),
			createElement(Page, props)
		);

	return Composed;
};

/** One React file route, as written by the generated route module. The
 *  type arguments check the route at compile time: `ServerModule`'s `load`
 *  must accept this path's params and return the page component's props
 *  (and must exist when the page has required props). */
export const reactFileRoute = <
	Path extends string,
	PageModule extends { default: unknown },
	ServerModule extends FileRouteServerModuleFor<Path, PagePropsOf<PageModule>>
>(
	route: ReactFileRouteInput<PageModule, ServerModule>
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
			const { layouts } = route;
			const Rendered =
				layouts && layouts.length > 0
					? await composeLayouts(Page, layouts, route.source)
					: Page;

			return handleReactPageRequest<Record<string, unknown>>({
				index: assetUnchecked(manifest, `${route.name}Index`),
				Page: Rendered,
				props,
				request
			});
		}
	);
