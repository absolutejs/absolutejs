import { file } from 'bun';
import { transformCurrentStaticPageHtml } from '../build/staticIslandPages';
import { injectIslandPageContext } from './islandPageContext';
import { extractStaticStreamingTags } from './staticStreaming';
import {
	type StreamingSlotEnhancerOptions,
	withStreamingSlots
} from './responseEnhancers';

export type StaticPageRequestOptions = StreamingSlotEnhancerOptions;

export type HTMLPageRequestOptions = StaticPageRequestOptions;

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

	return withStreamingSlots(
		new Response(injectIslandPageContext(transformedHtml), {
			headers: { 'Content-Type': 'text/html' }
		}),
		{
			...options,
			streamingSlots: options.streamingSlots ?? []
		}
	);
};

export const handleHTMLPageRequest = (
	pagePath: string,
	options?: HTMLPageRequestOptions
) => {
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

export const handleHTMXPageRequest = async (pagePath: string) => {
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
