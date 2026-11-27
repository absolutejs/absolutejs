/* Route-level holes: the dynamic parts of a pre-rendered page, declared
 * beside the route instead of inside the page (src/core/routeHoles.ts). */

/** What a hole's resolver is given: the visitor's request, and the
 *  route's params when its path has any. */
export type HoleContext<Params = Record<string, string | undefined>> = {
	params: Params;
	request: Request;
};

export type HoleFramework = 'angular' | 'react' | 'svelte' | 'vue';

/** A component to render into a hole, made by `holeComponent`. */
export type HoleComponent = {
	component: unknown;
	framework: HoleFramework;
	kind: 'absolute:hole-component';
	props: Record<string, unknown>;
};

/** What a hole resolves to: HTML, or a component rendered to it. */
export type HoleContent = HoleComponent | string;

export type HoleResolver<Params = Record<string, string | undefined>> = (
	context: HoleContext<Params>
) => HoleContent | Promise<HoleContent>;

/** A route's holes, keyed by the `id` of the slot each one fills. */
export type RouteHoles<Params = Record<string, string | undefined>> = Record<
	string,
	HoleResolver<Params>
>;
