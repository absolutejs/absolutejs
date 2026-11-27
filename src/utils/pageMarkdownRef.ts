/* What the rest of the server needs to know about pages being served
 * as Markdown (core/pageMarkdown.ts), kept apart from the plugin so a
 * page handler can read it without importing a plugin. */

/** Marks the request the Markdown plugin makes for the page itself. A
 *  route that has Markdown of its own answers it with that. */
export const MARKDOWN_SOURCE_HEADER = 'x-absolute-markdown-source';

const ENABLED = Symbol.for('absolutejs.pageMarkdown');

/** Whether this request is the Markdown plugin asking for a page. */
export const asksForMarkdownSource = (request: Request) =>
	request.headers.has(MARKDOWN_SOURCE_HEADER);

export const enablePageMarkdown = () => {
	Reflect.set(globalThis, ENABLED, true);
};

/** The address of a page's Markdown: `/about.md` for `/about`, and
 *  `/index.md` for `/`. */
export const markdownAddressOf = (pathname: string) => {
	const path = pathname.replace(/\/+$/, '');

	return path === '' ? '/index.md' : `${path}.md`;
};

/** The `Link` header value that tells a reader of a page where its
 *  Markdown is. Nothing when pages are not served as Markdown, for the
 *  plugin's own request, and for an address that is a file's. */
export const markdownAlternateLink = (request: Request | undefined) => {
	if (!request || Reflect.get(globalThis, ENABLED) !== true) return undefined;
	if (asksForMarkdownSource(request)) return undefined;
	const { pathname } = new URL(request.url);
	if (/\.[a-z0-9]+$/i.test(pathname)) return undefined;

	return `<${markdownAddressOf(pathname)}>; rel="alternate"; type="text/markdown"`;
};
