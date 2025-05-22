import { file } from "bun";
import { ComponentType, createElement } from "react";
import { renderToReadableStream } from "react-dom/server";

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

export const handleHTMLPageRequest = (html: string) => file(html);
