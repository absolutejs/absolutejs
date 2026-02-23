import type { Component as SvelteComponent } from 'svelte';
import { ssrErrorPage } from '../utils/ssrErrorPage';

// Declare overloads matching Svelte's own component API to preserve correct type inference
export type HandleSveltePageRequest = {
	(
		PageComponent: SvelteComponent<Record<string, never>>,
		pagePath: string,
		indexPath: string
	): Promise<Response>;
	<P extends Record<string, unknown>>(
		PageComponent: SvelteComponent<P>,
		pagePath: string,
		indexPath: string,
		props: P
	): Promise<Response>;
};

export const handleSveltePageRequest: HandleSveltePageRequest = async <
	P extends Record<string, unknown>
>(
	_PageComponent: SvelteComponent<P>,
	pagePath: string,
	indexPath: string,
	props?: P
) => {
	try {
		const { default: ImportedPageComponent } = await import(pagePath);
		const { renderToReadableStream } = await import(
			'./renderToReadableStream'
		);

		const renderStart = performance.now();
		const stream = await renderToReadableStream(
			ImportedPageComponent,
			props,
			{
				bootstrapModules: indexPath ? [indexPath] : [],
				bootstrapScriptContent: `window.__INITIAL_PROPS__=${JSON.stringify(
					props
				)};
				// Execute measurement after the window loads so Svelte has time to hydrate fully
				window.addEventListener('load', function() {
					var fallbackStart = performance.now();
					requestAnimationFrame(function () {
						var hmrBootTime = window.__hmrBootTime || fallbackStart;
						var endTime = performance.now();
						var hydrationTime = endTime - hmrBootTime;
						if (window.__HMR_WS__) {
							if (window.__HMR_WS__.readyState === 1) { // 1 = WebSocket.OPEN
								window.__HMR_WS__.send(JSON.stringify({
									type: 'hydration-metrics',
									metrics: {
										hydrationTimeMs: hydrationTime,
										mismatchWarnings: []
									}
								}));
							}
						}
					});
				});`
			}
		);
		const serverRenderTimeMs = performance.now() - renderStart;

		// Track server render time in a global dev registry
		if (process.env.NODE_ENV === 'development') {
			(globalThis as any).__ABS_LAST_SSR_METRICS__ = {
				serverRenderTimeMs,
				hydrationTimeMs: 0,
				payloadSizeBytes: 0, // Hard to measure exactly due to stream
				mismatchWarnings: []
			};
		}

		return new Response(stream, {
			headers: {
				'Content-Type': 'text/html',
				...(process.env.NODE_ENV === 'development' ? {
					'X-Absolute-Framework': 'svelte',
					'X-Absolute-Type': 'page',
					'X-Absolute-SSR': 'true'
				} : {})
			}
		});
	} catch (error) {
		console.error('[SSR] Svelte render error:', error);

		return new Response(ssrErrorPage('svelte', error), {
			status: 500,
			headers: { 'Content-Type': 'text/html' }
		});
	}
};
