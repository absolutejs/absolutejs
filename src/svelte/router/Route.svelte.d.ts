import { SvelteComponent, type Snippet } from 'svelte';
import type { ExtractRouteParams } from '../../../types/svelteRouter';

type RouteProps<Path extends string> = {
	path: Path;
	content: Snippet<[ExtractRouteParams<Path>]>;
};

class Route<Path extends string = string> extends SvelteComponent<
	RouteProps<Path>
> {}

export { Route as default };
