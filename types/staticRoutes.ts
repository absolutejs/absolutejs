/** A `static.routes` entry that could not become pages, and why. The
 *  same shape as a pre-render failure, so the CLI prints both alike. */
export type StaticRouteFailure = {
	reason: string;
	route: string;
};

export type StaticRouteExpansion = {
	failures: StaticRouteFailure[];
	/** Literal paths, ready to pre-render. */
	routes: string[];
};

/** Turns a `static.routes` list into the literal paths to pre-render. */
export type ExpandStaticRoutes = (
	listed: readonly string[]
) => Promise<StaticRouteExpansion>;
