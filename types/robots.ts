/* `robots.txt`, written by the build from the `robots` config key
 * (src/utils/generateRobots.ts). */

/** One group of a `robots.txt`: who it is for, and what they may and
 *  may not fetch. */
export type RobotsRule = {
	/** Paths the crawler may fetch. */
	allow?: string | string[];
	/** Seconds a crawler should wait between requests. Honoured by some
	 *  crawlers and ignored by others, Google's among them. */
	crawlDelay?: number;
	/** Paths the crawler may not fetch. */
	disallow?: string | string[];
	/** The crawlers this group is for: `'*'` (the default) for all of
	 *  them, a name such as `'GPTBot'`, or several. */
	userAgent?: string | string[];
};

export type RobotsConfig = {
	/** The groups, in the order written. Left out, every crawler is
	 *  allowed everything. */
	rules?: RobotsRule[];
	/** The `Sitemap:` line. `true` (the default) points at the sitemap
	 *  this build writes, at `sitemap.baseUrl`; a string or a list names
	 *  the sitemaps outright; `false` leaves the line out. A sitemap's
	 *  address has to be absolute, so `true` writes nothing when
	 *  `sitemap.baseUrl` is not set. */
	sitemap?: boolean | string | string[];
};
