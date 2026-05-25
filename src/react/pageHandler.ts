import type { ComponentType as ReactComponent } from 'react';
import { injectIslandPageContextStream } from '../core/islandPageContext';
import { getCurrentRouteRegistrationCallsite } from '../core/devRouteRegistrationCallsite';
import {
	type StreamingSlotEnhancerOptions,
	withRegisteredStreamingSlots
} from '../core/responseEnhancers';
import {
	captureStreamingSlotWarningCallsite,
	runWithStreamingSlotWarningScope
} from '../core/streamingSlotWarningScope';
import { ssrErrorPage } from '../utils/ssrErrorPage';
import {
	hasErrorConvention,
	renderConventionError,
	resolveErrorConventionPath
} from '../utils/resolveConvention';

type ReactPageRenderOptions = StreamingSlotEnhancerOptions & {
	collectStreamingSlots?: boolean;
};
export type ReactPageRequestInput<
	Props extends Record<string, unknown> = Record<never, never>
> = ReactPageRenderOptions & {
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

const resolveRequestPathname = (request: Request | undefined) => {
	if (!request) return undefined;

	try {
		const parsed = new URL(request.url);

		return `${parsed.pathname}${parsed.search}`;
	} catch {
		return undefined;
	}
};

const buildRefreshSetup = () => {
	if (process.env.NODE_ENV === 'production') {
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
) => {
	const {Page} = input;
	const resolvedIndex = input.index;
	const options = input;
	const userProps = input.props;
	const requestPathname = resolveRequestPathname(input.request);
	// Auto-inject `url` from the request when the caller didn't already
	// pass one in props. Lets users wire <StaticRouter location={url}>
	// just by forwarding `request` instead of unwrapping it themselves.
	const maybeProps =
		requestPathname !== undefined && (!userProps || !('url' in userProps))
			? ({
					...(userProps ?? {}),
					url: requestPathname
				} as unknown as Props)
			: userProps;
	const pageName = Page.name || Page.displayName || '';

	try {
		const handlerCallsite =
			options?.collectStreamingSlots === true
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
				? `window.__INITIAL_PROPS__=${JSON.stringify(maybeProps)};`
				: '';

			// Buffer React Refresh registrations until the runtime loads.
			// Bun.build injects $RefreshReg$ calls in the bundle, but the
			// real runtime isn't ready yet. This buffering function captures
			// all registrations, then replays them when the runtime is set up.
			const refreshSetup = buildRefreshSetup();

			const stream = await renderToReadableStream(element, {
				bootstrapModules: [resolvedIndex],
				bootstrapScriptContent: propsScript + refreshSetup || undefined,
				onError(error: unknown) {
					console.error('[SSR] React streaming error:', error);
				}
			});
			const htmlStream = injectIslandPageContextStream(stream);
			if (
				resolveErrorConventionPath('react', pageName) ||
				hasErrorConvention('react')
			) {
				const html = await new Response(htmlStream).text();

				return new Response(html, {
					headers: { 'Content-Type': 'text/html' }
				});
			}

			return new Response(htmlStream, {
				headers: { 'Content-Type': 'text/html' }
			});
		};

		return await runWithStreamingSlotWarningScope(
			() =>
				options?.collectStreamingSlots === true
					? withRegisteredStreamingSlots(renderPageResponse, options)
					: renderPageResponse(),
			{ handlerCallsite }
		);
	} catch (error) {
		console.error('[SSR] React render error:', error);

		const conventionResponse = await renderConventionError(
			'react',
			pageName,
			error
		);
		if (conventionResponse) return conventionResponse;

		return new Response(ssrErrorPage('react', error), {
			headers: { 'Content-Type': 'text/html' },
			status: 500
		});
	}
};
