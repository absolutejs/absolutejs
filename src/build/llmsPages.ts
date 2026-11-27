import type { LlmsPage } from '../utils/generateLlms';
import type { SitemapPage } from '../utils/generateSitemap';
import type { FileRoutePage } from './fileRouteSitemapPaths';

/* The pages an `llms.txt` lists: the sitemap's, once each, with what
 * the file routes' metadata says of them.
 *
 * Under i18n the sitemap lists a page once per locale. A reader wants
 * the page once, so it is listed in the default locale, or in the first
 * one listed when the default has no address of its own.
 *
 * `origin` is the address the sitemap was written with. When the site's
 * own address is not configured that is a placeholder, and the links
 * are written from the site's root instead: a link to a placeholder
 * host leads nowhere. */

type LlmsPagesOptions = {
	defaultLocale?: string;
	/** The origin to cut from each address, when it is a placeholder. */
	placeholderOrigin?: string;
};

const fromRoot = (url: string, origin: string | undefined) => {
	if (origin === undefined) return url;
	const root = origin.replace(/\/+$/, '');
	if (!url.startsWith(root)) return url;
	const rest = url.slice(root.length);

	return rest === '' ? '/' : rest;
};

const preferred = (
	current: SitemapPage | undefined,
	next: SitemapPage,
	defaultLocale: string | undefined
) => {
	if (current === undefined) return next;
	const isDefault =
		defaultLocale !== undefined && next.locale === defaultLocale;

	return isDefault ? next : current;
};

export const llmsPagesFrom = (
	listed: readonly SitemapPage[],
	fileRoutePages: readonly FileRoutePage[],
	{ defaultLocale, placeholderOrigin }: LlmsPagesOptions = {}
) => {
	const known = new Map(fileRoutePages.map((page) => [page.path, page]));
	const byPath = new Map<string, SitemapPage>();
	for (const page of listed) {
		byPath.set(
			page.path,
			preferred(byPath.get(page.path), page, defaultLocale)
		);
	}

	return [...byPath.values()].map((listedPage) => {
		const said = known.get(listedPage.path);
		const page: LlmsPage = {
			...(said?.description === undefined
				? {}
				: { description: said.description }),
			path: listedPage.path,
			...(said?.title === undefined ? {} : { title: said.title }),
			url: fromRoot(listedPage.url, placeholderOrigin)
		};

		return page;
	});
};
