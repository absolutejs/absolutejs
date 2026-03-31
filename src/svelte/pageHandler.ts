import type { Component as SvelteComponent } from 'svelte';
import { ssrErrorPage } from '../utils/ssrErrorPage';
import {
	derivePageName,
	renderConventionError
} from '../utils/resolveConvention';

let ssrDirty = false;

const buildDirtyResponse = (indexPath: string, props?: unknown) => {
	const propsScript = `window.__INITIAL_PROPS__=${JSON.stringify(props)};`;
	const dirtyFlag = 'window.__SSR_DIRTY__=true;';
	const scriptTag = indexPath
		? `<script type="module" src="${indexPath}"></script>`
		: '';
	const html = `<!DOCTYPE html><html><head></head><body><script>${propsScript}${dirtyFlag}</script>${scriptTag}</body></html>`;

	return new Response(html, {
		headers: { 'Content-Type': 'text/html' }
	});
};

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
		props: NoInfer<P>
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
	if (ssrDirty) {
		return buildDirtyResponse(indexPath, props);
	}

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

		const pageName = derivePageName(pagePath);
		const conventionResponse = await renderConventionError(
			'svelte',
			pageName,
			error
		);
		if (conventionResponse) return conventionResponse;

		return new Response(ssrErrorPage('svelte', error), {
			headers: { 'Content-Type': 'text/html' },
			status: 500
		});
	}
};

export const invalidateSvelteSsrCache = () => {
	ssrDirty = true;
};
