import type { ComponentType as ReactComponent } from 'react';
import { ssrErrorPage } from '../utils/ssrErrorPage';

export const handleReactPageRequest = async <
	Props extends Record<string, unknown> = Record<never, never>
>(
	PageComponent: ReactComponent<Props>,
	index: string,
	...props: keyof Props extends never ? [] : [props: NoInfer<Props>]
) => {
	try {
		const [maybeProps] = props;
		const { createElement } = await import('react');
		const { renderToReadableStream } = await import('react-dom/server');

		const element =
			maybeProps !== undefined
				? createElement(PageComponent, maybeProps)
				: createElement(PageComponent);

		const propsScript = maybeProps
			? `window.__INITIAL_PROPS__=${JSON.stringify(maybeProps)}`
			: '';

		const stream = await renderToReadableStream(element, {
			bootstrapModules: [index],
			bootstrapScriptContent: propsScript || undefined,
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
