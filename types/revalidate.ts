/** What became of one route's pre-rendered page: `replaced` with a new
 *  render (or created), `removed` because the route is no longer a
 *  page, or `failed`, which leaves whatever was there. */
export type RevalidationOutcome = 'failed' | 'removed' | 'replaced';

/** What `prepare()` registers so `revalidatePath` can reach the server
 *  that serves the pre-rendered files. */
export type Revalidator = {
	/** Whether a page may be created for a route that has none: one
	 *  `static.routes` lists or a pattern in it covers. */
	canCreate: (route: string) => boolean;
	/** Re-render one route and bring its page up to date. */
	revalidate: (route: string) => Promise<RevalidationOutcome>;
	/** The routes that are pre-rendered now. */
	routes: () => string[];
	/** The pre-rendered routes whose page declared any of `tags`. */
	routesTagged: (tags: readonly string[]) => string[];
};

export type RevalidateAllResult = {
	/** Routes whose render failed; they keep their previous page. */
	failed: string[];
	/** Routes that are no longer pages: their file was deleted and they
	 *  are rendered per request. */
	removed: string[];
	/** Routes whose page was replaced. */
	revalidated: string[];
};
