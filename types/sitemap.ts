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
};

export type SitemapConfig = {
	baseUrl?: string;
	exclude?: (string | RegExp)[];
	defaultChangefreq?: ChangeFrequency;
	defaultPriority?: number;
	overrides?: Record<string, SitemapRouteOverride>;
	routes?: () => string[] | Promise<string[]>;
};
