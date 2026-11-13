import { SvelteComponent, type Snippet } from 'svelte';
import type {
	ExtractRouteParams,
	LazyRouteLoader,
	RouteGuard
} from '../../../types/svelteRouter';

type RouteBaseProps<Path extends string> = {
	path: Path;
	/** Runs before navigating onto this route, after the router's guards
	 *  (and during the server render, where a redirect becomes a 302). */
	guard?: RouteGuard;
};

/** Eager route: render a snippet while the route is active. */
type EagerRouteProps<Path extends string> = RouteBaseProps<Path> & {
	content: Snippet<[ExtractRouteParams<Path>]>;
	loader?: never;
	props?: never;
	pending?: never;
	error?: never;
};

/** Lazy route: load the component on first use —
 *  `loader={() => import('./Page.svelte')}`. It receives the route params
 *  (plus `props`) as props. */
type LazyRouteProps<
	Path extends string,
	Props extends Record<string, unknown>
> = RouteBaseProps<Path> & {
	content?: never;
	loader: LazyRouteLoader<Props>;
	props?: Omit<Props, keyof ExtractRouteParams<Path>>;
	pending?: Snippet;
	error?: Snippet<[unknown, () => void]>;
};

type RouteProps<Path extends string, Props extends Record<string, unknown>> =
	EagerRouteProps<Path> | LazyRouteProps<Path, Props>;

class Route<
	Path extends string = string,
	Props extends Record<string, unknown> = ExtractRouteParams<Path>
> extends SvelteComponent<RouteProps<Path, Props>> {}

export { Route as default };
