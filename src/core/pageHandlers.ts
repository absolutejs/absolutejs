import { file } from 'bun';
import { transformCurrentStaticPageHtml } from '../build/staticIslandPages';
import { withPageCacheHeaders } from './pageResponseCache';
import { extractStaticStreamingTags } from './staticStreaming';
import {
	type StreamingSlotEnhancerOptions,
	withStreamingSlots
} from './responseEnhancers';
import { getCurrentAbsoluteRequest } from './requestContext';
import type { AbsoluteMobileBuildPageMetadata } from '../mobile/buildMetadata';
import {
	ABSOLUTE_MOBILE_PAGE_PROTOCOL_VERSION,
	finalizeAbsoluteMobilePage,
	type AbsoluteMobilePageFramework
} from '../mobile/pageProtocol';
import {
	htmlContainsIslands,
	injectIslandPageContext
} from './islandPageContext';
import { injectBrowserTranslationBaseline } from './browserTranslation';
import {
	derivePageName,
	renderConventionError
} from '../utils/resolveConvention';
import { ssrErrorPage } from '../utils/ssrErrorPage';
import { nonceStaticHtml, withHtmxStyleNonce } from './staticHtmlNonce';

export type StaticPageRequestOptions = StreamingSlotEnhancerOptions;

export type HTMLPageRequestOptions = StaticPageRequestOptions & {
	/** @internal Build-generated mobile identity. Application code must not set this. */
	__absoluteMobile?: AbsoluteMobileBuildPageMetadata;
};

type HTMXPageRequestOptions = {
	/** @internal Build-generated mobile identity. Application code must not set this. */
	__absoluteMobile?: AbsoluteMobileBuildPageMetadata;
};

const finalizeStaticMobilePage = (
	framework: Extract<AbsoluteMobilePageFramework, 'html' | 'htmx'>,
	pagePath: string,
	metadata: AbsoluteMobileBuildPageMetadata | undefined
) => {
	const pageId = metadata?.pageId ?? `${framework}:${pagePath}`;
	const contract =
		metadata?.contract ??
		`${framework}:${pageId}:${ABSOLUTE_MOBILE_PAGE_PROTOCOL_VERSION}`;

	return finalizeAbsoluteMobilePage({
		compatibility: {
			framework,
			pageId,
			representations: [{ contract, mapProps: () => ({}) }],
			runtimes: [String(ABSOLUTE_MOBILE_PAGE_PROTOCOL_VERSION)]
		},
		props: {},
		request: getCurrentAbsoluteRequest(),
		// Static pages carry their own asset links in the file the
		// browser is about to fetch, so route data only confirms the
		// route exists and names the page.
		route: { assets: { css: [] } }
	});
};

const handleStaticPageRequest = async (
	pagePath: string,
	options: StaticPageRequestOptions = {},
	settings: {
		enableHTMXStreaming?: boolean;
		enableStaticStreaming?: boolean;
	} = {}
) => {
	const nonced = await nonceStaticHtml(await file(pagePath).text());
	const html = settings.enableHTMXStreaming
		? await withHtmxStyleNonce(nonced)
		: nonced;
	const transformedHtml = await transformCurrentStaticPageHtml(
		html,
		settings
	);
	const htmlWithTranslationBaseline = htmlContainsIslands(transformedHtml)
		? injectBrowserTranslationBaseline(transformedHtml)
		: transformedHtml;

	return withPageCacheHeaders(
		await withStreamingSlots(
			new Response(injectIslandPageContext(htmlWithTranslationBaseline), {
				headers: { 'Content-Type': 'text/html' }
			}),
			{
				...options,
				streamingSlots: options.streamingSlots ?? []
			}
		)
	);
};

/* A static page that throws (or whose file can't be read) renders the
 * error convention like the framework handlers do: `<Page>.error.html` or
 * `error.html` (from the HTMX pages directory first for HTMX pages), with
 * `{{ stack }}` empty in production, then the built-in error page. */
const renderStaticPageError = async (
	framework: 'html' | 'htmx',
	pagePath: string,
	error: unknown
) => {
	console.error(`[SSR] ${framework.toUpperCase()} page error:`, error);
	const conventionResponse = await renderConventionError(
		framework,
		derivePageName(pagePath),
		error
	);

	return withPageCacheHeaders(
		conventionResponse ??
			new Response(ssrErrorPage(framework, error), {
				headers: { 'Content-Type': 'text/html' },
				status: 500
			})
	);
};

const renderHTMLPage = async (
	pagePath: string,
	options: HTMLPageRequestOptions | undefined
) => {
	const html = await file(pagePath).text();
	if (extractStaticStreamingTags(html).length > 0) {
		throw new Error(
			`HTML page "${pagePath}" uses <abs-stream-slot>, but HTML pages should pass explicit streamingSlots to handleHTMLPageRequest(...).`
		);
	}

	return handleStaticPageRequest(pagePath, options, {
		enableStaticStreaming: false
	});
};

export const handleHTMLPageRequest = async (
	pagePath: string,
	options?: HTMLPageRequestOptions
) => {
	const mobileResponse = finalizeStaticMobilePage(
		'html',
		pagePath,
		options?.__absoluteMobile
	);
	if (mobileResponse) return mobileResponse;

	try {
		return await renderHTMLPage(pagePath, options);
	} catch (error) {
		return renderStaticPageError('html', pagePath, error);
	}
};

const renderHTMXPage = async (pagePath: string) => {
	const html = await file(pagePath).text();
	if (extractStaticStreamingTags(html).length > 0) {
		throw new Error(
			`HTMX page "${pagePath}" uses <abs-stream-slot>, but HTMX pages should use native hx-* fragment requests instead.`
		);
	}

	return handleStaticPageRequest(
		pagePath,
		{},
		{
			enableHTMXStreaming: true,
			enableStaticStreaming: false
		}
	);
};

export const handleHTMXPageRequest = async (
	pagePath: string,
	options: HTMXPageRequestOptions = {}
) => {
	const mobileResponse = finalizeStaticMobilePage(
		'htmx',
		pagePath,
		options.__absoluteMobile
	);
	if (mobileResponse) return mobileResponse;

	try {
		return await renderHTMXPage(pagePath);
	} catch (error) {
		return renderStaticPageError('htmx', pagePath, error);
	}
};
