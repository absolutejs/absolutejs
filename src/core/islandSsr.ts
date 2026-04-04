import { type ComponentType, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { render as renderSvelte } from 'svelte/server';
import { createSSRApp, h } from 'vue';
import { renderToString as renderVueToString } from 'vue/server-renderer';
import { renderAngularIslandToHtml } from '../angular/islands';

export { renderAngularIslandToHtml };
export const renderReactIslandToHtml = <Props extends Record<string, unknown>>(
	component: ComponentType<Props>,
	props: Props
) => renderToStaticMarkup(createElement(component, props));
export const renderSvelteIslandToHtml = <Props extends Record<string, unknown>>(
	component: import('svelte').Component<Props>,
	props: Props
) => {
	const { body } = renderSvelte(component, { props });

	return body;
};
export const renderVueIslandToHtml = <Props extends Record<string, unknown>>(
	component: import('vue').Component<Props>,
	props: Props
) => {
	const app = createSSRApp({
		render: () => h(component, props)
	});

	return renderVueToString(app);
};
