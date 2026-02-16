import { file } from 'bun';
import { ComponentType as ReactComponent, createElement } from 'react';
import { renderToReadableStream as renderReactToReadableStream } from 'react-dom/server';
import { Component as SvelteComponent } from 'svelte';
import { Component as VueComponent, createSSRApp, h } from 'vue';
import { renderToWebStream as renderVueToWebStream } from 'vue/server-renderer';
import { renderToReadableStream as renderSvelteToReadableStream } from '../svelte/renderToReadableStream';
import { PropsArgs } from '../types';

const hasHMR = () =>
	Boolean((globalThis as Record<string, unknown>).__hmrDevResult);

const withDevHeaders = (
	response: Response,
	extraHeaders?: Record<string, string>
) => {
	if (!hasHMR()) {
		if (extraHeaders) {
			for (const [key, val] of Object.entries(extraHeaders)) {
				response.headers.set(key, val);
			}
		}
		return response;
	}
	response.headers.set(
		'Cache-Control',
		'no-store, no-cache, must-revalidate'
	);
	response.headers.set('Pragma', 'no-cache');
	const startup = (globalThis as Record<string, unknown>)
		.__hmrServerStartup as string | undefined;
	if (startup) {
		response.headers.set('X-Server-Startup', startup);
	}
	if (extraHeaders) {
		for (const [key, val] of Object.entries(extraHeaders)) {
			response.headers.set(key, val);
		}
	}
	return response;
};

export const handleReactPageRequest = async <
	Props extends Record<string, unknown> = Record<never, never>
>(
	pageComponent: ReactComponent<Props>,
	index: string,
	...props: keyof Props extends never ? [] : [props: Props]
) => {
	const [maybeProps] = props;
	const element =
		maybeProps !== undefined
			? createElement(pageComponent, maybeProps)
			: createElement(pageComponent);

	const stream = await renderReactToReadableStream(element, {
		bootstrapModules: [index],
		bootstrapScriptContent: maybeProps
			? `window.__INITIAL_PROPS__=${JSON.stringify(maybeProps)}`
			: undefined
	});

	const headers: Record<string, string> = {
		'Content-Type': 'text/html',
		'X-HMR-Framework': 'react'
	};

	return withDevHeaders(new Response(stream, { headers }), headers);
};

// Declare overloads matching Svelte's own component API to preserve correct type inference
type HandleSveltePageRequest = {
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
	const { default: ImportedPageComponent } = await import(pagePath);

	const stream = await renderSvelteToReadableStream(
		ImportedPageComponent,
		props,
		{
			bootstrapModules: indexPath ? [indexPath] : [],
			bootstrapScriptContent: `window.__INITIAL_PROPS__=${JSON.stringify(
				props
			)}`
		}
	);

	const headers: Record<string, string> = {
		'Content-Type': 'text/html',
		'X-HMR-Framework': 'svelte'
	};

	return withDevHeaders(new Response(stream, { headers }), headers);
};

export const handleVuePageRequest = async <
	Props extends Record<string, unknown> = Record<never, never>
>(
	_PageComponent: VueComponent<Props>,
	pagePath: string,
	indexPath: string,
	headTag: `<head>${string}</head>` = '<head></head>',
	...props: keyof Props extends never ? [] : [props: Props]
) => {
	const [maybeProps] = props;

	const { default: ImportedPageComponent } = await import(pagePath);

	const app = createSSRApp({
		render: () => h(ImportedPageComponent, maybeProps ?? {})
	});

	const bodyStream = renderVueToWebStream(app);

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

	const headers: Record<string, string> = {
		'Content-Type': 'text/html',
		'X-HMR-Framework': 'vue'
	};

	return withDevHeaders(new Response(stream, { headers }), headers);
};

export const handleHTMLPageRequest = async (pagePath: string) => {
	const headers: Record<string, string> = {
		'Content-Type': 'text/html; charset=utf-8',
		'X-HMR-Framework': 'html'
	};

	return withDevHeaders(new Response(file(pagePath), { headers }), headers);
};

export const handleHTMXPageRequest = async (pagePath: string) => {
	const headers: Record<string, string> = {
		'Content-Type': 'text/html; charset=utf-8',
		'X-HMR-Framework': 'htmx'
	};

	return withDevHeaders(new Response(file(pagePath), { headers }), headers);
};

export const handlePageRequest = <Component>(
	PageComponent: Component,
	...props: PropsArgs<Component>
) => {
	console.log('handlePageRequest coming soon.', PageComponent, props);
};
