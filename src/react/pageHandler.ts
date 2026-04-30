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
import { isSsrCacheDirty, markSsrCacheDirty } from '../core/ssrCache';
import { ssrErrorPage } from '../utils/ssrErrorPage';
import { renderConventionError } from '../utils/resolveConvention';

type ReactPageRenderOptions = StreamingSlotEnhancerOptions & {
	collectStreamingSlots?: boolean;
};
export type ReactPageRequestInput<
	Props extends Record<string, unknown> = Record<never, never>
> = ReactPageRenderOptions & {
	Page: ReactComponent<Props>;
	index: string;
} & (keyof Props extends never
		? { props?: NoInfer<Props> }
		: { props: NoInfer<Props> });

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

const buildDirtyResponse = (
	index: string,
	maybeProps: Record<string, unknown> | undefined
) => {
	const propsScript = maybeProps
		? `window.__INITIAL_PROPS__=${JSON.stringify(maybeProps)};`
		: '';
	const dirtyFlag = 'window.__SSR_DIRTY__=true;';
	const refreshSetup = buildRefreshSetup();
	const inlineScript = `${propsScript}${dirtyFlag}${refreshSetup}`;
	const html =
		`<!DOCTYPE html><html><head></head><body>` +
		`<script>${inlineScript}</script>` +
		`<script type="module" src="${index}"></script>` +
		`</body></html>`;

	return new Response(html, {
		headers: { 'Content-Type': 'text/html' }
	});
};

export const handleReactPageRequest = async <
	Props extends Record<string, unknown> = Record<never, never>
>(
	input: ReactPageRequestInput<Props>
) => {
	const Page = input.Page;
	const resolvedIndex = input.index;
	const options = input;
	const maybeProps = input.props;

	if (isSsrCacheDirty('react')) {
		return buildDirtyResponse(resolvedIndex, maybeProps);
	}

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

			return new Response(htmlStream, {
				headers: { 'Content-Type': 'text/html' }
			});
		};

		return runWithStreamingSlotWarningScope(
			() =>
				options?.collectStreamingSlots === true
					? withRegisteredStreamingSlots(renderPageResponse, options)
					: renderPageResponse(),
			{ handlerCallsite }
		);
	} catch (error) {
		console.error('[SSR] React render error:', error);

		const pageName = Page.name || Page.displayName || '';
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

export const invalidateReactSsrCache = () => {
	markSsrCacheDirty('react');
};
