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

		const stream = await renderToReadableStream(
			ImportedPageComponent,
			props,
			{
				bootstrapModules: indexPath ? [indexPath] : [],
				bootstrapScriptContent: `window.__INITIAL_PROPS__=${JSON.stringify(
					props
				)}`
			}
		);

		return new Response(stream, {
			headers: { 'Content-Type': 'text/html' }
		});
	} catch (error) {
		console.error('[SSR] Svelte render error:', error);

		return new Response(ssrErrorPage('svelte', error), {
			status: 500,
			headers: { 'Content-Type': 'text/html' }
		});
	}
};
