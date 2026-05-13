export type ChangeFrequency =
	| 'always'
	| 'hourly'
	| 'daily'
	| 'weekly'
	| 'monthly'
	| 'yearly'
	| 'never';

export type SitemapRouteOverride = {
	changefreq?: ChangeFrequency;
	priority?: number;
	lastmod?: string;
	/** Per-route opt-out. When set on a page handler's `sitemap` block
	 *  (e.g. `sitemap: { exclude: true }`), the route is omitted from
	 *  the generated sitemap.xml. Use for auth-gated routes, token
	 *  pages, or anything that shouldn't be crawled. */
	exclude?: boolean;
};

/** Per-route sitemap metadata, accepted as an optional `sitemap` field
 *  on every framework page-handler input (`handleAngularPageRequest`,
 *  `handleReactPageRequest`, etc.). Statically read off the handler
 *  source at registration time. */
export type PageHandlerSitemapMetadata = SitemapRouteOverride;

export type SitemapConfig = {
	baseUrl?: string;
	exclude?: (string | RegExp)[];
	defaultChangefreq?: ChangeFrequency;
	defaultPriority?: number;
	overrides?: Record<string, SitemapRouteOverride>;
	routes?: () => string[] | Promise<string[]>;
};
