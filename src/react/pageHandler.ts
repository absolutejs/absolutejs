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
		const propsScript = maybeProps
			? `window.__INITIAL_PROPS__=${JSON.stringify(maybeProps)}`
			: '';

		const stream = await renderToReadableStream(element, {
			bootstrapModules: [index],
			bootstrapScriptContent: refreshStubs + propsScript || undefined,
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
			status: 500,
			headers: { 'Content-Type': 'text/html' }
		});
	}
};
