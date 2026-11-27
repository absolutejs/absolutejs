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

/** Which of the crawlers run for language models may fetch the site.
 *  Each is `true` (the default: nothing is written, and the crawler
 *  follows the rules for everyone) or `false` (a group that disallows
 *  everything, for every crawler of that kind the framework knows by
 *  name). */
export type RobotsAiPolicy = {
	/** Fetchers that load a page because a person asked an assistant
	 *  about it, there and then (`AI_ASSISTANT_AGENTS`). Some of them
	 *  say they do not follow `robots.txt`, since a person sent them. */
	assistants?: boolean;
	/** Crawlers that index pages so an answer can cite and link them
	 *  (`AI_SEARCH_CRAWLERS`). Disallowing them takes the site out of
	 *  those answers. */
	search?: boolean;
	/** Crawlers that collect pages to train models on
	 *  (`AI_TRAINING_CRAWLERS`). */
	training?: boolean;
};

export type RobotsConfig = {
	/** Which crawlers run for language models may fetch the site, by
	 *  what they fetch it for. Written as groups after `rules`. */
	ai?: RobotsAiPolicy;
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
