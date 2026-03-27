import type { ComponentType as ReactComponent } from 'react';
import { ssrErrorPage } from '../utils/ssrErrorPage';

let ssrDirty = false;

const buildDirtyResponse = (
	index: string,
	maybeProps: Record<string, unknown> | undefined
) => {
	const propsScript = maybeProps
		? `window.__INITIAL_PROPS__=${JSON.stringify(maybeProps)};`
		: '';
	const dirtyFlag = 'window.__SSR_DIRTY__=true;';
	const refreshSetup =
		process.env.NODE_ENV !== 'production'
			? 'window.__REFRESH_BUFFER__=[];' +
				'window.$RefreshReg$=function(t,i){window.__REFRESH_BUFFER__.push([t,i])};' +
				'window.$RefreshSig$=function(){return function(t){return t}};'
			: '';
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
	PageComponent: ReactComponent<Props>,
	index: string,
	...props: keyof Props extends never ? [] : [props: NoInfer<Props>]
) => {
	const [maybeProps] = props;

	if (ssrDirty) {
		return buildDirtyResponse(index, maybeProps);
	}

	try {
		const { createElement } = await import('react');
		const { renderToReadableStream } = await import('react-dom/server');

		const element =
			maybeProps !== undefined
				? createElement(PageComponent, maybeProps)
				: createElement(PageComponent);

		const propsScript = maybeProps
			? `window.__INITIAL_PROPS__=${JSON.stringify(maybeProps)};`
			: '';

		// Buffer React Refresh registrations until the runtime loads.
		// Bun.build injects $RefreshReg$ calls in the bundle, but the
		// real runtime isn't ready yet. This buffering function captures
		// all registrations, then replays them when the runtime is set up.
		const refreshSetup =
			process.env.NODE_ENV !== 'production'
				? 'window.__REFRESH_BUFFER__=[];' +
					'window.$RefreshReg$=function(t,i){window.__REFRESH_BUFFER__.push([t,i])};' +
					'window.$RefreshSig$=function(){return function(t){return t}};'
				: '';

		const stream = await renderToReadableStream(element, {
			bootstrapModules: [index],
			bootstrapScriptContent: propsScript + refreshSetup || undefined,
			onError(error: unknown) {
				console.error('[SSR] React streaming error:', error);
			}
		});

		return new Response(stream, {
			headers: { 'Content-Type': 'text/html' }
		});
	} catch (error) {
		console.error('[SSR] React render error:', error);

		return new Response(ssrErrorPage('react', error), {
			headers: { 'Content-Type': 'text/html' },
			status: 500
		});
	}
};

export const invalidateReactSsrCache = () => {
	ssrDirty = true;
};
