import { file } from "bun";
import { ComponentType, createElement } from "react";
import { renderToReadableStream } from "react-dom/server";

export const handleReactPageRequest = async <P extends object>(
	pageComponent: ComponentType<P>,
	index: string,
	...props: keyof P extends never ? [] : [props: P]
): Promise<Response> => {
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

export const handleHTMLPageRequest = (html: string) => file(html);
