/* `llms.txt`, written by the build from the `llms` config key
 * (src/utils/generateLlms.ts). */

/** One link in an `llms.txt` list. */
export type LlmsLink = {
	/** What is at the address, in a sentence. */
	description?: string;
	/** The link's text. */
	title: string;
	/** Where it points: absolute, or from the site's root. */
	url: string;
};

/** A titled list of links, written by hand. */
export type LlmsSection = {
	links: LlmsLink[];
	title: string;
};

/** How `llms-full.txt` is made. */
export type LlmsFullConfig = {
	/** The most pages the file holds, in the order `llms.txt` lists
	 *  them. Default 500. */
	maxPages?: number;
	/** Seconds the server keeps the file before making it again.
	 *  Default 3600. */
	revalidate?: number;
};

export type LlmsConfig = {
	/** Anything a reader should know before the lists: Markdown, placed
	 *  under the summary. */
	details?: string;
	/** Pages left out of the file: a path, or a pattern tested against
	 *  one. Pages left out of the sitemap are already left out. */
	exclude?: (string | RegExp)[];
	/** Pages a reader short of room can skip. They are listed under
	 *  `## Optional`, which is what the format calls that list. */
	optional?: (string | RegExp)[];
	/** Also serve `llms-full.txt`: the text of every page `llms.txt`
	 *  lists, in one Markdown file. The running server makes it the
	 *  first time it is asked for, from the pages as it serves them to a
	 *  visitor who is not signed in, and keeps it. */
	full?: boolean | LlmsFullConfig;
	/** `false` leaves out the list of the site's own pages, for a file
	 *  made of `sections` alone. */
	pages?: boolean;
	/** Lists written by hand, placed before the site's own pages: the
	 *  documentation, an API reference, anything not a page here. */
	sections?: LlmsSection[];
	/** One or two sentences on what the site is. Left out, it is the
	 *  home page's `description`, when its metadata has one. */
	summary?: string;
	/** The site's name, the file's heading. Left out, it is the home
	 *  page's title, and failing that the site's host name. */
	title?: string;
};
