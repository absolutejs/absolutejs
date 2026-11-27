import { Elysia } from 'elysia';
import { htmlToMarkdown, inlineStreamedSlots } from '../utils/htmlToMarkdown';
import {
	enablePageMarkdown,
	MARKDOWN_SOURCE_HEADER
} from '../utils/pageMarkdownRef';

/* A page as Markdown, for a reader that wants the text and not the
 * markup: `/about.md` beside `/about`, and `/about` itself when the
 * request says `Accept: text/markdown`.
 *
 * The Markdown is made from the page: the request is answered by asking
 * the app for the page as HTML and converting what comes back
 * (utils/htmlToMarkdown.ts). So it is whatever the page is for this
 * request — its guards have run, its `load` has run, a pre-rendered
 * page is the pre-rendered one — and a page that would redirect or
 * refuse answers the same way here.
 *
 * A file route may say what its Markdown is, with `export const
 * markdown` in its server module; that is served as written, and the
 * page is not rendered. Every page's HTML response carries a `Link`
 * header naming its Markdown (pageResponseCache.ts).
 *
 * `/about.md` only stands for the page when `/about` is one. Anything
 * else — a real `.md` file in the public directory, a route of that
 * name — is left to whatever serves it. */

const MARKDOWN_TYPE = 'text/markdown';
const HTML_TYPE = 'text/html';
const SUFFIX = '.md';

type Handle = (request: Request) => Promise<Response>;

/* A browser never asks for Markdown, and a reader that accepts both
 * gets the page: Markdown is for a request that asks for it alone. */
const asksForMarkdown = (accept: string | null) =>
	accept !== null &&
	accept.includes(MARKDOWN_TYPE) &&
	!accept.includes(HTML_TYPE);

/* `/about.md` is `/about`; `/index.md` is `/`. */
const pagePathOf = (pathname: string) => {
	const path = pathname.slice(0, -SUFFIX.length);

	return path === '/index' || path === '' ? '/' : path;
};

const pageRequest = (request: Request, url: URL) => {
	const headers = new Headers(request.headers);
	headers.set('accept', HTML_TYPE);
	headers.set(MARKDOWN_SOURCE_HEADER, '1');
	// The page is read here, not sent: uncompressed and in full.
	headers.delete('accept-encoding');
	headers.delete('if-none-match');
	headers.delete('if-modified-since');

	return new Request(url, { headers, method: 'GET' });
};

const answer = async (request: Request, handle: Handle | undefined) => {
	if (request.method !== 'GET' || !handle) return undefined;
	if (request.headers.has(MARKDOWN_SOURCE_HEADER)) return undefined;
	const url = new URL(request.url);
	const bySuffix = url.pathname.endsWith(SUFFIX);
	if (!bySuffix && !asksForMarkdown(request.headers.get('accept')))
		return undefined;
	if (bySuffix) url.pathname = pagePathOf(url.pathname);
	const page = await handle(pageRequest(request, url));
	const type = page.headers.get('content-type') ?? '';
	// A route with Markdown of its own has answered with it
	// (fileRoutes.ts): that is the page's Markdown, as written.
	const isOwn = page.ok && type.includes(MARKDOWN_TYPE);
	const isPage = isOwn || (page.ok && type.includes(HTML_TYPE));
	if (!isPage && bySuffix) {
		await page.body?.cancel();

		return undefined;
	}
	// Asked for by `Accept`, the address is the page's own: what the
	// page answered — a redirect, a refusal, something not HTML — is
	// the answer.
	if (!isPage) return page;
	const body = await page.text();
	const markdown = isOwn
		? body
		: await htmlToMarkdown(await inlineStreamedSlots(body));

	return new Response(markdown, {
		headers: {
			'content-type': `${MARKDOWN_TYPE}; charset=utf-8`,
			// The page is the thing to cite; this is a rendering of it.
			...(bySuffix
				? { link: `<${url.pathname}${url.search}>; rel="canonical"` }
				: {}),
			vary: 'Accept'
		}
	});
};

/** Serves every page as Markdown too, when `markdown` is set in the
 *  config. */
export const pageMarkdown = (enabled: boolean | undefined) => {
	if (!enabled) return new Elysia({ name: 'absolutejs-page-markdown-off' });
	enablePageMarkdown();
	let handle: Handle | undefined;
	const plugin = new Elysia({ name: 'absolutejs-page-markdown' }).onRequest(
		({ request }) => answer(request, handle)
	);
	plugin.onStart((app) => {
		handle = (request) => app.handle(request);
	});

	return plugin;
};
