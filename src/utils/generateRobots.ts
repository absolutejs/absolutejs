import {
	AI_ASSISTANT_AGENTS,
	AI_SEARCH_CRAWLERS,
	AI_TRAINING_CRAWLERS
} from '../constants';
import type {
	RobotsAiPolicy,
	RobotsConfig,
	RobotsRule
} from '../../types/robots';

/* The text of a `robots.txt`.
 *
 * What a crawler is asked not to fetch, and where the sitemap is. It
 * is advice to crawlers that choose to follow it, and it is about
 * FETCHING: a page a crawler may not fetch can still be listed in
 * search results if something links to it. Keeping a page out of
 * results is `robots: { index: false }` in the page's metadata, which a
 * crawler has to be allowed to fetch the page to see — so a page marked
 * that way must not also be disallowed here. */

const listOf = (value: string | string[] | undefined) =>
	value === undefined ? [] : [value].flat();

/* A line break in a value would start a line of the file's own. */
const oneLine = (value: string) => value.replace(/[\r\n]+/g, ' ').trim();

const groupLines = (rule: RobotsRule) => {
	const agents = listOf(rule.userAgent);
	const allow = listOf(rule.allow);
	const disallow = listOf(rule.disallow);

	return [
		...(agents.length > 0 ? agents : ['*']).map(
			(agent) => `User-agent: ${oneLine(agent)}`
		),
		...allow.map((path) => `Allow: ${oneLine(path)}`),
		...disallow.map((path) => `Disallow: ${oneLine(path)}`),
		// A group has to say something: one with no rules allows all.
		...(allow.length === 0 && disallow.length === 0 ? ['Allow: /'] : []),
		...(rule.crawlDelay === undefined
			? []
			: [`Crawl-delay: ${rule.crawlDelay}`])
	];
};

const DEFAULT_RULES: RobotsRule[] = [{ allow: '/', userAgent: '*' }];

/* The groups `robots.ai` asks for: one per kind turned off, naming
 * every crawler of that kind and disallowing everything. A crawler
 * follows the group that names it over the one for `*`, so these hold
 * whatever `rules` says to everyone. A kind left on writes nothing. */
const aiRules = (policy: RobotsAiPolicy | undefined) => {
	const kinds: [boolean | undefined, string[]][] = [
		[policy?.training, AI_TRAINING_CRAWLERS],
		[policy?.search, AI_SEARCH_CRAWLERS],
		[policy?.assistants, AI_ASSISTANT_AGENTS]
	];

	return kinds.flatMap(([allowed, userAgent]) => {
		if (allowed !== false) return [];
		const rule: RobotsRule = { disallow: '/', userAgent };

		return [rule];
	});
};

const sitemapsOf = (
	sitemap: RobotsConfig['sitemap'],
	baseUrl: string | undefined
) => {
	if (sitemap === false) return [];
	if (sitemap === undefined || sitemap === true)
		return baseUrl === undefined
			? []
			: [`${baseUrl.replace(/\/+$/, '')}/sitemap.xml`];

	return listOf(sitemap);
};

/** The text of a `robots.txt` for `config`. `baseUrl` is the site's
 *  own address (`sitemap.baseUrl`), for the `Sitemap:` line. */
export const generateRobots = (
	config: RobotsConfig | true,
	baseUrl?: string
) => {
	const {
		ai: aiPolicy,
		rules,
		sitemap
	}: RobotsConfig = config === true ? {} : config;
	const groups = [
		...(rules && rules.length > 0 ? rules : DEFAULT_RULES),
		...aiRules(aiPolicy)
	].map((rule) => groupLines(rule).join('\n'));
	const sitemaps = sitemapsOf(sitemap, baseUrl).map(
		(address) => `Sitemap: ${oneLine(address)}`
	);

	return `${[...groups, ...(sitemaps.length > 0 ? [sitemaps.join('\n')] : [])].join('\n\n')}\n`;
};
