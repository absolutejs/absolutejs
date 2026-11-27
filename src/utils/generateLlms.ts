import type { LlmsConfig, LlmsLink } from '../../types/llms';

/* The text of an `llms.txt`.
 *
 * A Markdown file at the site's root that says what the site is and
 * lists its pages, for a language model reading the site on someone's
 * behalf: a heading with the site's name, a quoted summary, and lists
 * of links, each with a sentence on what is there. It is a proposal
 * (llmstxt.org), not a standard, and nothing obliges a model's crawler
 * to read it. It costs a small file.
 *
 * It lists pages a build can know: the ones in the sitemap. A page's
 * link text and sentence come from its `metadata`, when that is written
 * as a value; a page with none is listed by its path. */

/** A page the site serves, as much as a build knows about it. */
export type LlmsPage = {
	description?: string;
	/** The page's path, which `exclude` and `optional` are tested
	 *  against. */
	path: string;
	title?: string;
	/** The page's address as it is written in the file. */
	url: string;
};

const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim();

/* A `]` would end the link's text, and a `[` would start another. */
const linkText = (value: string) =>
	oneLine(value).replace(/[\\[\]]/g, (char) => `\\${char}`);

/* A space or a `)` would end the address. */
const linkAddress = (value: string) =>
	oneLine(value).replace(
		/[\s()<>]/g,
		(char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
	);

const linkLine = ({ description, title, url }: LlmsLink) => {
	const said = description === undefined ? '' : oneLine(description);

	return `- [${linkText(title)}](${linkAddress(url)})${said === '' ? '' : `: ${said}`}`;
};

const matches = (path: string, patterns: (string | RegExp)[] | undefined) =>
	(patterns ?? []).some((pattern) =>
		typeof pattern === 'string' ? pattern === path : pattern.test(path)
	);

const list = (title: string, links: LlmsLink[]) =>
	links.length === 0
		? []
		: [`## ${oneLine(title)}\n\n${links.map(linkLine).join('\n')}`];

const hostOf = (baseUrl: string | undefined) => {
	if (baseUrl === undefined) return undefined;
	try {
		return new URL(baseUrl).host;
	} catch {
		return undefined;
	}
};

const pageLink = (page: LlmsPage) => {
	const link: LlmsLink = {
		...(page.description === undefined
			? {}
			: { description: page.description }),
		title: page.title ?? page.path,
		url: page.url
	};

	return link;
};

/** The text of an `llms.txt` for `config`, listing `pages`. `baseUrl`
 *  is the site's own address (`sitemap.baseUrl`). */
export const generateLlms = (
	config: LlmsConfig | true,
	pages: readonly LlmsPage[],
	baseUrl?: string
) => {
	const settings: LlmsConfig = config === true ? {} : config;
	const home = pages.find((page) => page.path === '/');
	const summary = settings.summary ?? home?.description;
	const listed =
		settings.pages === false
			? []
			: pages.filter((page) => !matches(page.path, settings.exclude));
	const optional = listed.filter((page) =>
		matches(page.path, settings.optional)
	);
	const main = listed.filter(
		(page) => !matches(page.path, settings.optional)
	);
	const blocks = [
		`# ${oneLine(llmsTitle(settings, pages, baseUrl) ?? 'Site')}`,
		...(summary === undefined || oneLine(summary) === ''
			? []
			: [`> ${oneLine(summary)}`]),
		...(settings.details === undefined || settings.details.trim() === ''
			? []
			: [settings.details.trim()]),
		...(settings.sections ?? []).flatMap((section) =>
			list(section.title, section.links)
		),
		...list('Pages', main.map(pageLink)),
		...list('Optional', optional.map(pageLink))
	];

	return `${blocks.join('\n\n')}\n`;
};

/** The site's name for the file's heading: the one configured, the
 *  home page's title, or the host name. `undefined` when none of them
 *  is known. */
export const llmsTitle = (
	config: LlmsConfig | true,
	pages: readonly LlmsPage[],
	baseUrl?: string
) => {
	const configured = config === true ? undefined : config.title;
	const home = pages.find((page) => page.path === '/');

	return configured ?? home?.title ?? hostOf(baseUrl);
};
