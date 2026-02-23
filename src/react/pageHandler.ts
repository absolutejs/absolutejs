import type { ComponentType as ReactComponent } from 'react';
import { ssrErrorPage } from '../utils/ssrErrorPage';

export const handleReactPageRequest = async <
	Props extends Record<string, unknown> = Record<never, never>
>(
	PageComponent: ReactComponent<Props>,
	index: string,
	...props: keyof Props extends never ? [] : [props: Props]
) => {
	try {
		const [maybeProps] = props;
		const { createElement } = await import('react');
		const { renderToReadableStream } = await import('react-dom/server');

		const element =
			maybeProps !== undefined
				? createElement(PageComponent, maybeProps)
				: createElement(PageComponent);

		// In dev mode, Bun's reactFastRefresh injects $RefreshReg$/$RefreshSig$
		// calls into component code. With code splitting, shared component chunks
		// may load before the chunk containing reactRefreshSetup.ts — causing a
		// ReferenceError. These no-op stubs ensure the globals exist before any
		// module code runs. reactRefreshSetup.ts overwrites them with the real
		// implementations once its chunk executes.
		const refreshStubs =
			process.env.NODE_ENV === 'development'
				? 'window.$RefreshReg$=function(){};window.$RefreshSig$=function(){return function(t){return t}};'
				: '';
		const hydrationScript = process.env.NODE_ENV === 'development' ? `
			window.__MEASURE_HYDRATION__ = function(startTime) {
				requestAnimationFrame(function() {
					// startTime is now a relative performance.now() captured when HMR client initialized
					const endTime = performance.now();
					const hydrationTime = endTime - startTime;
					// console.log('[DevTracker] React Hydration Complete:', hydrationTime, 'ms');
					if (window.__HMR_WS__ && window.__HMR_WS__.readyState === WebSocket.OPEN) {
						window.__HMR_WS__.send(JSON.stringify({
							type: 'hydration-metrics',
							metrics: {
								hydrationTimeMs: hydrationTime,
								mismatchWarnings: []
							}
						}));
					}
				});
			};
		` : '';

		const propsScript = maybeProps
			? `window.__INITIAL_PROPS__=${JSON.stringify(maybeProps)};`
			: '';

		const renderStart = performance.now();
		const stream = await renderToReadableStream(element, {
			bootstrapModules: [index],
			bootstrapScriptContent: refreshStubs + propsScript + hydrationScript || undefined,
			onError(error: unknown) {
				console.error('[SSR] React streaming error:', error);
			}
		});
		const serverRenderTimeMs = performance.now() - renderStart;

		if (process.env.NODE_ENV === 'development') {
			(globalThis as any).__ABS_LAST_SSR_METRICS__ = {
				serverRenderTimeMs,
				hydrationTimeMs: 0,
				payloadSizeBytes: 0,
				mismatchWarnings: []
			};
		}

		return new Response(stream, {
			headers: {
				'Content-Type': 'text/html',
				...(process.env.NODE_ENV === 'development' ? {
					'X-Absolute-Framework': 'react',
					'X-Absolute-Type': 'page',
					'X-Absolute-SSR': 'true'
				} : {})
			}
		});
	} catch (error) {
		console.error('[SSR] React render error:', error);

		return new Response(ssrErrorPage('react', error), {
			status: 500,
			headers: { 'Content-Type': 'text/html' }
		});
	}
};
