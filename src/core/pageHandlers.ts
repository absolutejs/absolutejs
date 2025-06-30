import { file } from 'bun';
import { ComponentType, createElement } from 'react';
import { renderToReadableStream as renderReactToReadableStream } from 'react-dom/server';
import { Component } from 'svelte';
import { renderToReadableStream as renderSvelteToReadableStream } from '../svelte/renderToReadableStream';

export const handleReactPageRequest = async <
	Props extends Record<string, unknown> = Record<never, never>
>(
	pageComponent: ComponentType<Props>,
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

// Declare overloads matching Svelte’s own component API to preserve correct type inference
type HandleSveltePageRequest = {
	(
		PageComponent: Component<Record<string, never>>,
		manifest: Record<string, string>
	): Promise<Response>;
	<P extends Record<string, unknown>>(
		PageComponent: Component<P>,
		manifest: Record<string, string>,
		props: P
	): Promise<Response>;
};

export const handleSveltePageRequest: HandleSveltePageRequest = async <
	P extends Record<string, unknown>
>(
	PageComponent: Component<P>,
	manifest: Record<string, string>,
	props?: P
) => {
	const componentPath = PageComponent.toString();
	const pathSegments = componentPath.split('/');
	const lastSegment = pathSegments[pathSegments.length - 1] ?? '';
	const componentName = lastSegment.replace(/\.svelte$/, '');

	const pagePath = manifest[componentName];
	const indexPath = manifest[`${componentName}Index`];

	const { default: ImportedPageComponent } = await import(pagePath);

	const stream = await renderSvelteToReadableStream(
		ImportedPageComponent,
		props,
		{
			bootstrapModules: [indexPath],
			bootstrapScriptContent: `window.__INITIAL_PROPS__=${JSON.stringify(
				props
			)}`
		}
	);

	return new Response(stream, {
		headers: { 'Content-Type': 'text/html' }
	});
};

export const handleHTMLPageRequest = (html: string) => file(html);
