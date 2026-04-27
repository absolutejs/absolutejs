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
export const renderReactIslandToHtml = <Props extends Record<string, unknown>>(
	component: ReactComponentType<Props>,
	props: Props
) =>
	import('react').then(({ createElement }) =>
		import('react-dom/server').then(({ renderToStaticMarkup }) =>
			renderToStaticMarkup(createElement(component, props))
		)
	);
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
