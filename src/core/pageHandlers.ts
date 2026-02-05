import { bootstrapApplication } from '@angular/platform-browser';
import {
	provideServerRendering,
	renderApplication
} from '@angular/platform-server';
import { file } from 'bun';
import { join, resolve } from 'node:path';
import { ComponentType as ReactComponent, createElement } from 'react';
import { renderToReadableStream as renderReactToReadableStream } from 'react-dom/server';
import { Component as SvelteComponent } from 'svelte';
import { Component as VueComponent, createSSRApp, h } from 'vue';
import { renderToWebStream as renderVueToWebStream } from 'vue/server-renderer';
import { renderToReadableStream as renderSvelteToReadableStream } from '../svelte/renderToReadableStream';
import { PropsArgs } from '../types';

type BuildResultLike = {
	manifest: Record<string, string>;
	buildDir: string;
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

	return new Response(stream, {
		headers: { 'Content-Type': 'text/html' }
	});
};

// Declare overloads matching Svelte's own component API to preserve correct type inference
type HandleSveltePageRequest = {
	(
		PageComponent: SvelteComponent<Record<string, never>>,
		pagePath: string,
		indexPath: string,
		result: BuildResultLike
	): Promise<Response>;
	<P extends Record<string, unknown>>(
		PageComponent: SvelteComponent<P>,
		pagePath: string,
		indexPath: string,
		result: BuildResultLike,
		props: P
	): Promise<Response>;
};

export const handleSveltePageRequest: HandleSveltePageRequest = async <
	P extends Record<string, unknown>
>(
	_PageComponent: SvelteComponent<P>,
	pagePath: string,
	indexPath: string,
	result: BuildResultLike,
	props?: P
) => {
	// Convert URL path to file system path
	// pagePath is like "/svelte/compiled/pages/SvelteExample.abc123.js"
	// Resolve relative to result.buildDir
	const fsPath = resolve(result.buildDir, pagePath.replace(/^\//, ''));

	const { default: ImportedPageComponent } = await import(fsPath);

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
		headers: { 'Content-Type': 'text/html' }
	});
};

export const handleVuePageRequest = async <
	Props extends Record<string, unknown> = Record<never, never>
>(
	_PageComponent: VueComponent<Props>,
	pagePath: string,
	indexPath: string,
	result: BuildResultLike,
	headTag: `<head>${string}</head>` = '<head></head>',
	...props: keyof Props extends never ? [] : [props: Props]
) => {
	const [maybeProps] = props;

	// Convert URL path to file system path
	// pagePath is like "/vue/compiled/pages/VueExample.abc123.js"
	// Resolve relative to result.buildDir
	const fsPath = resolve(result.buildDir, pagePath.replace(/^\//, ''));

	const { default: ImportedPageComponent } = await import(fsPath);

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
		headers: { 'Content-Type': 'text/html' }
	});
};

export const handleAngularPageRequest = async (
	pagePath: string,
	indexPath: string,
	template:
		| string
		| Document = '<!DOCTYPE html><html><head></head><body><app-root></app-root></body></html>'
) => {
	// @ts-expect-error - Angular sucks
	if (!('Zone' in globalThis)) await import('zone.js/node');

	const { default: ImportedPageComponent } = await import(pagePath);

	const html = await renderApplication(
		() =>
			bootstrapApplication(ImportedPageComponent, {
				providers: [provideServerRendering()]
			}),
		{ document: template }
	);

	return new Response(html, {
		headers: { 'Content-Type': 'text/html' }
	});
};

export const handleHTMLPageRequest = async (
	result: BuildResultLike,
	assetName: string
) => {
	const relativePath = result.manifest[assetName];
	if (!relativePath) {
		throw new Error(`HTML asset "${assetName}" not found in manifest`);
	}
	const htmlPath = join(result.buildDir, relativePath.replace(/^\//, ''));
	const htmlFile = file(htmlPath);
	const html = await htmlFile.text();

	return new Response(html, {
		headers: { 'Content-Type': 'text/html; charset=utf-8' }
	});
};

export const handleHTMXPageRequest = async (
	result: BuildResultLike,
	assetName: string
) => {
	const relativePath = result.manifest[assetName];
	if (!relativePath) {
		throw new Error(`HTMX asset "${assetName}" not found in manifest`);
	}
	const htmxPath = join(result.buildDir, relativePath.replace(/^\//, ''));
	const htmxFile = file(htmxPath);
	const html = await htmxFile.text();

	return new Response(html, {
		headers: { 'Content-Type': 'text/html; charset=utf-8' }
	});
};

export const handlePageRequest = <Component>(
	PageComponent: Component,
	...props: PropsArgs<Component>
) => {
	console.log('handlePageRequest coming soon.', PageComponent, props);
};
