import { createSSRApp, h, type App as VueApp } from 'vue';

const vueIslandApps = new WeakMap<HTMLElement, VueApp>();

const isPropsRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

export const isVueComponent = (
	value: unknown
): value is import('vue').Component<Record<string, unknown>> =>
	typeof value === 'function' || isPropsRecord(value);

export const hydrateVueIsland = (
	component: import('vue').Component<Record<string, unknown>>,
	element: HTMLElement,
	props: unknown
) => {
	if (vueIslandApps.has(element)) {
		return;
	}

	const app = createSSRApp({
		render: () => h(component, isPropsRecord(props) ? props : undefined)
	});
	app.mount(element);
	vueIslandApps.set(element, app);
};
