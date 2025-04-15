import { ComponentType, createElement } from "react";
//@ts-expect-error - TODO: Remove this when we upgrade to React 19
import { renderToReadableStream } from "react-dom/server.browser";

export const handleReactPageRequest = async (
	pageComponent: ComponentType,
	index: string
) => {
	const page = createElement(pageComponent);
	const stream = await renderToReadableStream(page, {
		bootstrapModules: [index]
	});

	return new Response(stream, {
		headers: { "Content-Type": "text/html" }
	});
};

export const handleHTMLPageRequest = (html: string) => Bun.file(html);
