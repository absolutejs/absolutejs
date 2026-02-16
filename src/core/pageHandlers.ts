import { file } from 'bun';
import { ComponentType as ReactComponent, createElement } from 'react';
import { renderToReadableStream as renderReactToReadableStream } from 'react-dom/server';
import { Component as SvelteComponent } from 'svelte';
import { Component as VueComponent, createSSRApp, h } from 'vue';
import { renderToWebStream as renderVueToWebStream } from 'vue/server-renderer';
import {
	getHMRBodyScripts,
	getHMRHeadScripts,
	injectHMRClient
} from '../dev/injectHMRClient';
import { renderToReadableStream as renderSvelteToReadableStream } from '../svelte/renderToReadableStream';
import { PropsArgs } from '../types';

const hasHMR = (): boolean =>
	Boolean((globalThis as Record<string, unknown>).__hmrDevResult);

function withDevHeaders(
	response: Response,
	extraHeaders?: Record<string, string>
): Response {
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
}

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

	if (hasHMR()) {
		const headScripts = getHMRHeadScripts('react');
		const bodyScripts = getHMRBodyScripts('react');
		const encoder = new TextEncoder();
		const decoder = new TextDecoder();
		let injectedHead = false;
		let injectedBody = false;

		const hmrStream = stream.pipeThrough(
			new TransformStream<Uint8Array, Uint8Array>({
				transform(chunk, controller) {
					if (injectedHead && injectedBody) {
						controller.enqueue(chunk);
						return;
					}

					const text = decoder.decode(chunk, { stream: true });
					let result = text;

					if (!injectedHead) {
						const headMatch = /<head[^>]*>/i.exec(result);
						if (headMatch) {
							const pos = headMatch.index + headMatch[0].length;
							result =
								result.slice(0, pos) +
								headScripts +
								result.slice(pos);
							injectedHead = true;
						}
					}

					if (!injectedBody) {
						const bodyCloseMatch = /<\/body\s*>/i.exec(result);
						if (bodyCloseMatch) {
							const pos = bodyCloseMatch.index;
							result =
								result.slice(0, pos) +
								bodyScripts +
								result.slice(pos);
							injectedBody = true;
						}
					}

					controller.enqueue(encoder.encode(result));
				},
				flush(controller) {
					if (!injectedBody) {
						controller.enqueue(encoder.encode(bodyScripts));
					}
				}
			})
		);

		return withDevHeaders(new Response(hmrStream, { headers }), headers);
	}

	return new Response(stream, { headers });
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
			)}`,
			headContent: hasHMR() ? getHMRHeadScripts('svelte') : undefined,
			bodyContent: hasHMR() ? getHMRBodyScripts('svelte') : undefined
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

	const headWithHMR = hasHMR()
		? headTag.replace('</head>', getHMRHeadScripts('vue') + '</head>')
		: headTag;
	const hmrBody = hasHMR() ? getHMRBodyScripts('vue') : '';

	const head = `<!DOCTYPE html><html>${headWithHMR}<body><div id="root">`;
	const tail = `</div><script>window.__INITIAL_PROPS__=${JSON.stringify(
		maybeProps ?? {}
	)}</script><script type="module" src="${indexPath}"></script>${hmrBody}</body></html>`;

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

export const handleHTMLPageRequest = async (
	pagePath: string
): Promise<Response> => {
	const htmlFile = file(pagePath);
	const html = hasHMR()
		? injectHMRClient(await htmlFile.text(), 'html')
		: await htmlFile.text();

	const headers: Record<string, string> = {
		'Content-Type': 'text/html; charset=utf-8',
		'X-HMR-Framework': 'html'
	};

	return withDevHeaders(new Response(html, { headers }), headers);
};

export const handleHTMXPageRequest = async (
	pagePath: string
): Promise<Response> => {
	const htmxFile = file(pagePath);
	const html = hasHMR()
		? injectHMRClient(await htmxFile.text(), 'htmx')
		: await htmxFile.text();

	const headers: Record<string, string> = {
		'Content-Type': 'text/html; charset=utf-8',
		'X-HMR-Framework': 'htmx'
	};

	return withDevHeaders(new Response(html, { headers }), headers);
};

export const handlePageRequest = <Component>(
	PageComponent: Component,
	...props: PropsArgs<Component>
) => {
	console.log('handlePageRequest coming soon.', PageComponent, props);
};
