type ReactComponentType<Props extends Record<string, unknown>> =
	import('react').ComponentType<Props>;

const renderAngularIslandToHtmlInternal = async (
	component: import('@angular/core').Type<object>,
	props: Record<string, unknown>,
	islandId: string
) => {
	const { renderAngularIslandToHtml } = await import('../angular/islands');

	return renderAngularIslandToHtml(component, props, islandId);
};
export const renderAngularIslandToHtml = renderAngularIslandToHtmlInternal;
// React 19 hoists resources (`<link rel="preload">` for images, stylesheet
// links, etc.) to the FRONT of server output. In a full document these go to
// `<head>`. An island is SSR'd as an isolated fragment, so they land inline as
// leading siblings before the component's real root — but during standalone
// client hydration React routes the same resources to `document.head` instead,
// so the fragment's first child differs (server `<link>`, client the component
// root) and hydration mismatches. Strip these leading hoisted tags so the SSR
// fragment matches what the island root renders on the client. They're perf
// hints; dropping them from the fragment doesn't affect the rendered UI.
const LEADING_HOISTED_RESOURCE_RE =
	/^\s*(?:<link\b[^>]*\/?>|<meta\b[^>]*\/?>|<title\b[^>]*>[\s\S]*?<\/title>|<style\b[^>]*>[\s\S]*?<\/style>|<script\b[^>]*>[\s\S]*?<\/script>)/i;

const stripLeadingHoistedResources = (html: string) => {
	let result = html;
	let match = LEADING_HOISTED_RESOURCE_RE.exec(result);
	while (match) {
		result = result.slice(match[0].length);
		match = LEADING_HOISTED_RESOURCE_RE.exec(result);
	}

	return result.trimStart();
};

/* Rendered with renderToReadableStream, not renderToString: `absolute start`
 * stubs out React's legacy string renderer in the production server bundle,
 * so renderToString is undefined there. Awaiting `allReady` before reading
 * makes the stream flush the finished markup in one pass, like the string
 * renderer did. */
export const renderReactIslandToHtml = async <
	Props extends Record<string, unknown>
>(
	component: ReactComponentType<Props>,
	props: Props
) => {
	const { createElement } = await import('react');
	const { renderToReadableStream } = await import('react-dom/server');
	const stream = await renderToReadableStream(
		createElement(component, props)
	);
	await stream.allReady;
	const html = await new Response(stream).text();

	return stripLeadingHoistedResources(html);
};
export const renderSvelteIslandToHtml = <Props extends Record<string, unknown>>(
	component: import('svelte').Component<Props>,
	props: Props
) =>
	import('svelte/server').then(({ render }) => {
		const { body } = render(component, { props });

		return body;
	});
export const renderVueIslandToHtml = <Props extends Record<string, unknown>>(
	component: import('vue').Component<Props>,
	props: Props
) =>
	import('vue').then(({ createSSRApp, h: createVueVNode }) => {
		const app = createSSRApp({
			render: () => createVueVNode(component, props)
		});

		return import('vue/server-renderer').then(({ renderToString }) =>
			renderToString(app)
		);
	});
