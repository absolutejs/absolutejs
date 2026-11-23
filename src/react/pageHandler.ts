import {
	basePathHeadTags,
	getBasePath,
	insertAfterHeadOpen,
	withBasePath
} from '../utils/basePath';
import { HTML_CONTENT_TYPE } from '../constants';
import { requestRenderUrl } from '../utils/requestRenderUrl';
import { readCspNonce } from '../utils/cspNonceRef';
import { serializeInitialProps } from '../utils/initialProps';
import { isProductionRuntime } from '../utils/runtimeMode';
import type { ComponentType as ReactComponent } from 'react';
import { injectIslandPageContextStream } from '../core/islandPageContext';
import { getCurrentRouteRegistrationCallsite } from '../core/devRouteRegistrationCallsite';
import {
	devBuildErrorResponse,
	getCurrentAbsoluteRequest,
	resolveDeferredPageAssets,
	setPageEntry
} from '../core/requestContext';
import {
	ABSOLUTE_MOBILE_PAGE_PROTOCOL_VERSION,
	finalizeAbsoluteMobilePage
} from '../mobile/pageProtocol';
import type { AbsoluteMobileBuildPageMetadata } from '../mobile/buildMetadata';
import {
	streamingPageHeaders,
	withPageCacheHeaders
} from '../core/pageResponseCache';
import {
	type StreamingSlotEnhancerOptions,
	withRegisteredStreamingSlots
} from '../core/responseEnhancers';
import {
	captureStreamingSlotWarningCallsite,
	runWithStreamingSlotWarningScope
} from '../core/streamingSlotWarningScope';
import { ssrErrorPage } from '../utils/ssrErrorPage';
import { renderSpaNotFound } from '../utils/spaRouteManifest';
import { renderConventionError } from '../utils/resolveConvention';
import { BROWSER_TRANSLATION_BASELINE_SCRIPT } from '../core/browserTranslation';
import { reportServerError } from '../core/errorReporter';
import { ABS_RENDER_ATTRS, withRenderSpan } from '../core/renderTracing';
import type { RenderSpan } from '../../types/tracing';

type ReactPageRenderOptions = StreamingSlotEnhancerOptions & {
	/** Collect `<SuspenseSlot>` / `<StreamSlot>` registrations during the
	 *  render and stream their resolved content after the shell. On by
	 *  default: a page that renders no slot gets byte-identical output and
	 *  no extra work. Set `false` to turn collection off for this route;
	 *  slots then stay on their fallback and a warning is logged once. */
	collectStreamingSlots?: boolean;
	/** Buffer this page's stream so it can carry a content-hash `ETag` and
	 *  serve a `304` on repeat visits, at the cost of streaming's fast first
	 *  byte. Only worth it on pages static enough that the 304 beats the
	 *  stream. See {@link PageCacheOptions.bufferStreamForEtag}. */
	bufferStreamForEtag?: boolean;
};
export type ReactPageRequestInput<
	Props extends Record<string, unknown> = Record<never, never>
> = ReactPageRenderOptions & {
	/** @internal Build-generated mobile identity. Application code must not set this. */
	__absoluteMobile?: AbsoluteMobileBuildPageMetadata;
	Page: ReactComponent<Props>;
	index: string;
	/** The incoming Elysia request. When provided, the request's pathname
	 *  is auto-injected into props as `url` so the Page can wire
	 *  `<StaticRouter location={url}>` on the server without the caller
	 *  threading the URL by hand. User-supplied `props.url` (if present)
	 *  takes precedence — the auto-injection only fills in when missing. */
	request?: Request;
	/** Sitemap metadata for this route. Statically read from the handler
	 *  source at registration time, so only literal-object values are
	 *  honoured. */
	sitemap?: import('../../types/sitemap').PageHandlerSitemapMetadata;
} & (keyof Props extends never
		? { props?: NoInfer<Props> }
		: { props: NoInfer<Props> });
type PropsWithUrlBuilder = <Props extends Record<string, unknown>>(
	props: Props | undefined,
	url: string
) => Props;
const withRequestUrl: PropsWithUrlBuilder = (props, url) =>
	Object.assign(Object.create(null), props, { url });

const resolveRequestPathname = (request: Request | undefined) =>
	requestRenderUrl(request);

const buildRefreshSetup = () => {
	if (isProductionRuntime()) {
		return '';
	}

	return (
		'window.__REFRESH_BUFFER__=[];' +
		'window.$RefreshReg$=function(t,i){window.__REFRESH_BUFFER__.push([t,i])};' +
		'window.$RefreshSig$=function(){return function(t){return t}};'
	);
};

export const handleReactPageRequest = async <
	Props extends Record<string, unknown> = Record<never, never>
>(
	input: ReactPageRequestInput<Props>
) =>
	withRenderSpan(
		'render.page',
		{ framework: 'react', phase: 'page' },
		(span) => renderReactPageRequest(input, span)
	);

const renderReactPageRequest = async <
	Props extends Record<string, unknown> = Record<never, never>
>(
	input: ReactPageRequestInput<Props>,
	span: RenderSpan
) => {
	const { Page } = input;
	// Dev on-demand pages: `asset()` returned `''` for an index that has
	// not been built yet. Build the page now and re-read the manifest;
	// otherwise fall through to the manifest error so the overlay shows
	// the real cause.
	const deferredAssets =
		input.index === '' ? await resolveDeferredPageAssets() : null;
	const buildFailure = devBuildErrorResponse('react', deferredAssets);
	if (buildFailure) return buildFailure;
	const resolvedIndex =
		deferredAssets && input.index === ''
			? deferredAssets.lookup(`${deferredAssets.name}Index`)
			: input.index;
	const options = input;
	const userProps = input.props;
	const request = input.request ?? getCurrentAbsoluteRequest();
	const requestPathname = resolveRequestPathname(request);
	// Auto-inject `url` from the request when the caller didn't already
	// pass one in props. Lets users wire <StaticRouter location={url}>
	// just by forwarding `request` instead of unwrapping it themselves.
	const maybeProps =
		requestPathname !== undefined && (!userProps || !('url' in userProps))
			? withRequestUrl(userProps, requestPathname)
			: userProps;
	const pageName = Page.name || Page.displayName || '';
	/* Named on the span once it is known: the span opens before the
	 * manifest and the page are resolved, which is work worth having inside
	 * it. */
	if (pageName !== '') span.setAttribute(ABS_RENDER_ATTRS.page, pageName);
	if (resolvedIndex === '') {
		throw new Error(
			`Asset "${deferredAssets?.name || pageName || 'Page'}Index" not found in manifest.`
		);
	}
	const pageId =
		input.__absoluteMobile?.pageId ?? (pageName || resolvedIndex);
	const currentContract =
		input.__absoluteMobile?.contract ??
		`react:${pageId}:${ABSOLUTE_MOBILE_PAGE_PROTOCOL_VERSION}`;
	const mobileResponse = finalizeAbsoluteMobilePage({
		compatibility: {
			framework: 'react',
			pageId,
			representations: [
				{ contract: currentContract, mapProps: (props) => props }
			],
			runtimes: [String(ABSOLUTE_MOBILE_PAGE_PROTOCOL_VERSION)]
		},
		props: maybeProps ?? Object.create(null),
		request,
		// Web route data: the assets a hovered `<Link>` warms before the
		// click. React pages own their `<head>` inside the component, so
		// the handler can only name the client entry (plus any stylesheet
		// an on-demand dev build just resolved).
		route: () => ({
			assets: {
				css: (deferredAssets?.cssHrefs() ?? []).map((href) =>
					withBasePath(href)
				),
				index: withBasePath(resolvedIndex)
			}
		})
	});
	if (mobileResponse) return mobileResponse;

	try {
		const spaNotFound = await renderSpaNotFound('react', pageName, request);
		if (spaNotFound) return withPageCacheHeaders(spaNotFound, request);
		// Slot collection is on unless the handler opts out with `false`:
		// installing the collector costs nothing when no slot registers.
		const collectStreamingSlots = options?.collectStreamingSlots !== false;
		const handlerCallsite = collectStreamingSlots
			? undefined
			: (getCurrentRouteRegistrationCallsite() ??
				captureStreamingSlotWarningCallsite());
		const renderPageResponse = async () => {
			const { createElement } = await import('react');
			const { renderToReadableStream } = await import('react-dom/server');

			const element =
				maybeProps !== undefined
					? createElement(Page, maybeProps)
					: createElement(Page);

			const propsScript = maybeProps
				? `window.__INITIAL_PROPS__=${serializeInitialProps(
						maybeProps,
						`The React page ${pageName || resolvedIndex}`
					)};`
				: '';

			// Buffer React Refresh registrations until the runtime loads.
			// Bun.build injects $RefreshReg$ calls in the bundle, but the
			// real runtime isn't ready yet. This buffering function captures
			// all registrations, then replays them when the runtime is set up.
			const refreshSetup = buildRefreshSetup();

			/* Recorded where the entry is known: a streamed page sends its
			 * headers long before this markup exists. */
			setPageEntry(withBasePath(resolvedIndex));

			const stream = await renderToReadableStream(element, {
				// Under a base path the browser reaches the entry through it.
				bootstrapModules: [withBasePath(resolvedIndex)],
				bootstrapScriptContent:
					BROWSER_TRANSLATION_BASELINE_SCRIPT +
					propsScript +
					refreshSetup,
				// React writes this nonce on its bootstrap and streaming
				// scripts when secureHeaders() is on.
				nonce: readCspNonce(),
				onError(error: unknown) {
					console.error('[SSR] React streaming error:', error);
					/* `stream`, not `page`: the first byte is already sent,
					 * so the visitor has a partial page and the status code
					 * cannot say so. */
					reportServerError({
						error,
						framework: 'react',
						kind: 'stream'
					});
				}
			});
			const htmlStream = insertAfterHeadOpen(
				injectIslandPageContextStream(stream, {
					host: 'react'
				}),
				// First in <head>: the import map must precede the entry's
				// modulepreload, or the browser ignores it.
				basePathHeadTags(getBasePath(), readCspNonce())
			);
			/* An error convention used to turn streaming off: the whole
			 * document was buffered with `await new Response(stream).text()`
			 * so the handler's `catch` could answer with the convention's
			 * error page instead of half a document. It cost every page in
			 * an app with an `error.tsx` its streaming, silently — adding
			 * that file is an unrelated-looking act, and the only symptom is
			 * a page that got slower.
			 *
			 * It also bought nothing. The only error that can be answered
			 * with an error page is one in the SHELL, and
			 * `renderToReadableStream` rejects for those before a byte is
			 * written — above, inside this same `try`, so the catch gets it
			 * either way. An error after the shell is React's to report
			 * through a boundary: by then the status and the opening markup
			 * are committed, and buffering changes nothing about that except
			 * when the user sees the part that worked. */

			return new Response(htmlStream, {
				headers: streamingPageHeaders()
			});
		};

		const pageResponse = await runWithStreamingSlotWarningScope(
			() =>
				collectStreamingSlots
					? withRegisteredStreamingSlots(renderPageResponse, options)
					: renderPageResponse(),
			{ explicitlyDisabled: !collectStreamingSlots, handlerCallsite }
		);

		return withPageCacheHeaders(pageResponse, request, {
			bufferStreamForEtag: input.bufferStreamForEtag
		});
	} catch (error) {
		console.error('[SSR] React render error:', error);
		reportServerError({ error, framework: 'react', kind: 'page' });

		const conventionResponse = await renderConventionError(
			'react',
			pageName,
			error
		);
		if (conventionResponse) {
			return withPageCacheHeaders(conventionResponse, request);
		}

		return withPageCacheHeaders(
			new Response(ssrErrorPage('react', error), {
				headers: { 'Content-Type': HTML_CONTENT_TYPE },
				status: 500
			}),
			request
		);
	}
};
