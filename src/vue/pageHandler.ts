import type { Component as VueComponent } from 'vue';
import { ssrErrorPage } from '../utils/ssrErrorPage';

let ssrDirty = false;

const buildDirtyResponse = (
	headTag: string,
	indexPath: string,
	maybeProps: Record<string, unknown> | undefined
) => {
	const propsScript = `window.__INITIAL_PROPS__=${JSON.stringify(maybeProps ?? {})};`;
	const dirtyFlag = 'window.__SSR_DIRTY__=true;';
	const html =
		`<!DOCTYPE html><html>${headTag}<body><div id="root"></div>` +
		`<script>${propsScript}${dirtyFlag}</script>` +
		`<script type="module" src="${indexPath}"></script>` +
		`</body></html>`;

	return new Response(html, {
		headers: { 'Content-Type': 'text/html' }
	});
};

export const handleVuePageRequest = async <
	Props extends Record<string, unknown> = Record<never, never>
>(
	_PageComponent: VueComponent<Props>,
	pagePath: string,
	indexPath: string,
	headTag: `<head>${string}</head>` = '<head></head>',
	...props: keyof Props extends never ? [] : [props: NoInfer<Props>]
) => {
	const [maybeProps] = props;

	if (ssrDirty) {
		return buildDirtyResponse(headTag, indexPath, maybeProps);
	}

	try {
		const { default: ImportedPageComponent } = await import(pagePath);
		const { createSSRApp, h } = await import('vue');
		const { renderToWebStream } = await import('vue/server-renderer');

		const app = createSSRApp({
			render: () => h(ImportedPageComponent, maybeProps ?? null)
		});

		const bodyStream = renderToWebStream(app);

		const head = `<!DOCTYPE html><html>${headTag}<body><div id="root">`;
		const tail = `</div><script>window.__INITIAL_PROPS__=${JSON.stringify(
			maybeProps ?? {}
		)}</script><script type="module" src="${indexPath}"></script></body></html>`;

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

		return new Response(stream, {
			headers: { 'Content-Type': 'text/html' }
		});
	} catch (error) {
		console.error('[SSR] Vue render error:', error);

		return new Response(ssrErrorPage('vue', error), {
			headers: { 'Content-Type': 'text/html' },
			status: 500
		});
	}
};

export const invalidateVueSsrCache = () => {
	ssrDirty = true;
};
