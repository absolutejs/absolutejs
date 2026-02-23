import type { Component as VueComponent } from 'vue';
import { ssrErrorPage } from '../utils/ssrErrorPage';

export const handleVuePageRequest = async <
	Props extends Record<string, unknown> = Record<never, never>
>(
	_PageComponent: VueComponent<Props>,
	pagePath: string,
	indexPath: string,
	headTag: `<head>${string}</head>` = '<head></head>',
	...props: keyof Props extends never ? [] : [props: Props]
) => {
	try {
		const [maybeProps] = props;

		const { default: ImportedPageComponent } = await import(pagePath);
		const { createSSRApp, h } = await import('vue');
		const { renderToWebStream } = await import('vue/server-renderer');

		const app = createSSRApp({
			render: () => h(ImportedPageComponent, maybeProps ?? null)
		});

		const renderStart = performance.now();
		const bodyStream = renderToWebStream(app);

		const head = `<!DOCTYPE html><html>${headTag}<body><div id="root">`;
		const hydrationScript = process.env.NODE_ENV === 'development' ? `
			<script type="module">
			// Vue specific hydration execution check. Executes sequentially after the framework is initialized.
			const startTime = performance.now();
			requestAnimationFrame(function() {
				// startTime is a relative performance.now() captured when HMR client initialized
				const hmrBootTime = window.__hmrBootTime || startTime;
				const endTime = performance.now();
				const hydrationTime = endTime - hmrBootTime;
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
			</script>
		` : '';

		const tail = `</div><script>window.__INITIAL_PROPS__=${JSON.stringify(
			maybeProps ?? {}
		)}</script>${hydrationScript}<script type="module" src="${indexPath}"></script></body></html>`;

		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(head);
				const reader = bodyStream.getReader();
				const pumpLoop = () => {
					reader
						.read()
						.then(({ done, value }) =>
							done
								? (controller.enqueue(tail), controller.close())
								: (controller.enqueue(value), pumpLoop())
						)
						.catch((err) => controller.error(err));
				};
				pumpLoop();
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
					'X-Absolute-Framework': 'vue',
					'X-Absolute-Type': 'page',
					'X-Absolute-SSR': 'true'
				} : {})
			}
		});
	} catch (error) {
		console.error('[SSR] Vue render error:', error);

		return new Response(ssrErrorPage('vue', error), {
			status: 500,
			headers: { 'Content-Type': 'text/html' }
		});
	}
};
