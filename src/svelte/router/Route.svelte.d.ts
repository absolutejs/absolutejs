import type { Snippet } from 'svelte';
import type { ExtractRouteParams } from '../../../types/svelteRouter';

type RouteProps<Path extends string> = {
	path: Path;
	content: Snippet<[ExtractRouteParams<Path>]>;
};

import { SvelteComponent } from 'svelte';

export default class Route<
	Path extends string = string
> extends SvelteComponent<RouteProps<Path>> {}
