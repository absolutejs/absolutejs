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
		request: getCurrentAbsoluteRequest()
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
	const html = await file(pagePath).text();
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

export const handleHTMLPageRequest = (
	pagePath: string,
	options?: HTMLPageRequestOptions
) => {
	const mobileResponse = finalizeStaticMobilePage(
		'html',
		pagePath,
		options?.__absoluteMobile
	);
	if (mobileResponse) return Promise.resolve(mobileResponse);
	const htmlFile = file(pagePath);

	return htmlFile.text().then((html) => {
		if (extractStaticStreamingTags(html).length > 0) {
			throw new Error(
				`HTML page "${pagePath}" uses <abs-stream-slot>, but HTML pages should pass explicit streamingSlots to handleHTMLPageRequest(...).`
			);
		}

		return handleStaticPageRequest(pagePath, options, {
			enableStaticStreaming: false
		});
	});
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
