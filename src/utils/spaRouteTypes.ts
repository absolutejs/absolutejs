/* Cross-framework types for the sitemap pipeline's static SPA-route
 * analyzers. Each framework adapter (Angular, React, Svelte, Vue)
 * parses its source files statically and returns `SpaHost[]`, which
 * the sitemap pipeline then matches against Elysia's wildcard page
 * routes to emit one entry per non-dynamic leaf. */

export type SpaRoute = {
	/** Full joined path within the SPA (no mount-path prefix). */
	path: string;
	/** `true` when any segment is `:param`, `*`, or `**`. */
	dynamic: boolean;
	/** `true` when this route is purely a `redirectTo` — sitemap skips. */
	redirected: boolean;
	/** `true` when an explicit opt-out marker was found
	 *  (`Route.data.sitemap === 'exclude'` in Angular, etc.). */
	sitemapExcluded: boolean;
};

export type SpaHost = {
	/** Absolute path of the source file the routes were read from. */
	sourceFile: string;
	/** Mount path the page expects to be served at — e.g. `'/portal/'`,
	 *  `'/admin/'`. Frameworks express this differently:
	 *  - Angular: `{ provide: APP_BASE_HREF, useValue: '...' }`
	 *  - React: `<BrowserRouter basename="...">` or
	 *    `createBrowserRouter(routes, { basename: '...' })`
	 *  - Vue: `createRouter({ history: createWebHistory('...') })`
	 *  - Svelte: `<Router basepath="...">` */
	baseHref: string;
	/** Leaf routes extracted from the page's router config. */
	routes: SpaRoute[];
};
