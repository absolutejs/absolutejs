import { file } from "bun";
import { ComponentType, createElement } from "react";
import { renderToReadableStream as renderReactToReadableStream } from "react-dom/server";
import { Component } from "svelte";
import { renderToReadableStream as renderSvelteToReadableStream } from "../svelte/renderToReadableStream";

export const handleReactPageRequest = async <P extends object>(
	pageComponent: ComponentType<P>,
	index: string,
	...props: keyof P extends never ? [] : [props: P]
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
		headers: { "Content-Type": "text/html" }
	});
};

export const handleSveltePageRequest = async <
	Props extends Record<string, unknown>
>(
	pageComponent: Component<Props>,
	index: string,
	props: Props
) => {
	const stream = await renderSvelteToReadableStream(pageComponent, props, {
		bootstrapModules: [index],
		bootstrapScriptContent: `window.__INITIAL_PROPS__=${JSON.stringify(
			props
		)}`
	});

	return new Response(stream, {
		headers: { "Content-Type": "text/html" }
	});
};

export const handleHTMLPageRequest = (html: string) => file(html);
