import { file } from "bun";
import { ComponentType, createElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { Component } from "svelte";
import { render } from "svelte/server";

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

	const stream = await renderToReadableStream(element, {
		bootstrapModules: [index],
		bootstrapScriptContent: maybeProps
			? `window.__INITIAL_PROPS__=${JSON.stringify(maybeProps)}`
			: undefined
	});

	return new Response(stream, {
		headers: { "Content-Type": "text/html" }
	});
};

export const handleSveltePageRequest = <Props extends Record<string, unknown>>(
	pageComponent: Component<Props>,
	index: string,
	props: Props
) => {
	const serializedProps = JSON.stringify(props).replace(/</g, "\\u003c");

	const { body, head } = render(pageComponent, { props });
	const html = `<!DOCTYPE html>
	<html lang="en">
	<head>
	${head}
	</head>
	<body>
	${body}
	<script>window.__INITIAL_PROPS__=${serializedProps};</script>
	<script type="module" src="${index}"></script>
	</body>
	</html>`;

	return new Response(html, {
		headers: { "Content-Type": "text/html" }
	});
};

export const handleHTMLPageRequest = (html: string) => file(html);
