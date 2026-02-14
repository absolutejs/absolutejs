import { file } from 'bun';
import { ComponentType as ReactComponent, createElement } from 'react';
import { renderToReadableStream as renderReactToReadableStream } from 'react-dom/server';
import { Component as SvelteComponent } from 'svelte';
import { Component as VueComponent, createSSRApp, h } from 'vue';
import { renderToWebStream as renderVueToWebStream } from 'vue/server-renderer';
import { renderToReadableStream as renderSvelteToReadableStream } from '../svelte/renderToReadableStream';
import { PropsArgs } from '../types';

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

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/html',
			'X-HMR-Framework': 'react'
		}
	});
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

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/html',
			'X-HMR-Framework': 'svelte'
		}
	});
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

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/html',
			'X-HMR-Framework': 'vue'
		}
	});
};

export const handleHTMLPageRequest = async (pagePath: string) => {
	const htmlFile = file(pagePath);
	const html = await htmlFile.text();

	return new Response(html, {
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'X-HMR-Framework': 'html'
		}
	});
};

export const handleHTMXPageRequest = async (pagePath: string) => {
	const htmxFile = file(pagePath);
	const html = await htmxFile.text();

	return new Response(html, {
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'X-HMR-Framework': 'htmx'
		}
	});
};

export const handlePageRequest = <Component>(
	PageComponent: Component,
	...props: PropsArgs<Component>
) => {
	console.log('handlePageRequest coming soon.', PageComponent, props);
};
